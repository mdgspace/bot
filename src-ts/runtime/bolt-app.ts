import { App, ExpressReceiver, LogLevel } from "@slack/bolt";
import express from "express";
import type { ListenOptions } from "node:net";
import { Bot } from "./bot";
import { Brain, BrainPersistence } from "./brain";
import { createRedisStorage, type BotStorage } from "./redis-storage";
import { slackApi, type SlackApi, type SlackIdentity } from "./slack-api";
import { SlackDirectory, SlackEvents, SlackTransport } from "./slack-adapter";
import { inboxEvent, InboxWorker } from "./event-inbox";
import type { Logger } from "./types";

export interface BoltConfig {
  token: string;
  signingSecret: string;
  name: string;
  alias?: string;
  version: string;
  port: number;
}

export function boltConfiguration(env: NodeJS.ProcessEnv, version: string): BoltConfig {
  if (!env.SLACK_BOT_TOKEN?.trim()) throw new Error("SLACK_BOT_TOKEN is required");
  if (!env.SLACK_SIGNING_SECRET?.trim()) throw new Error("SLACK_SIGNING_SECRET is required");
  const port = Number(env.PORT ?? "8080");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be an integer between 1 and 65535");
  return {
    token: env.SLACK_BOT_TOKEN,
    signingSecret: env.SLACK_SIGNING_SECRET,
    name: env.BOT_NAME || env.HUBOT_NAME || "bot",
    alias: env.BOT_ALIAS || env.HUBOT_ALIAS || undefined,
    version,
    port,
  };
}

export interface BoltBotOptions {
  config: BoltConfig;
  register(bot: Bot): void | Promise<void>;
  // Called after loading memory but before importing/registering scripts. The
  // entrypoint can restore persisted environment configuration here.
  beforeScripts?(brain: Brain, logger: Logger): void | Promise<void>;
  env?: NodeJS.ProcessEnv;
  api?: SlackApi;
  storage?: BotStorage;
}

/** Builds the app without network activity. Only initialize()/start() connect. */
export function createBoltBot(options: BoltBotOptions) {
  const { config } = options;
  let ready = false;
  const httpApp = express();
  httpApp.use("/slack/events", (_req, res, next) => {
    // Let Slack retry while Redis reconnects, rather than acknowledging events
    // that cannot be checked for duplicate delivery.
    if (!ready || !storage.ready) { res.sendStatus(503); return; }
    next();
  });
  const receiver = new ExpressReceiver({
    app: httpApp,
    signingSecret: config.signingSecret,
    endpoints: "/slack/events",
    signatureVerification: true,
    // Listeners only persist an inbox entry. Slow API calls and scripts run
    // in the worker after this write, outside Slack's acknowledgement deadline.
    processBeforeResponse: true,
  });
  let identity: SlackIdentity | undefined;
  const app = new App({
    receiver,
    socketMode: false,
    convoStore: false,
    logLevel: LogLevel.INFO,
    // Custom authorization avoids an auth.test call in Bolt's constructor and
    // confines this installation to the workspace authenticated at startup.
    authorize: async () => {
      if (!identity) throw new Error("Slack identity is not ready");
      return { botToken: config.token, botId: identity.botId, botUserId: identity.botUserId, teamId: identity.teamId };
    },
  });
  const api = options.api ?? slackApi(app.client, config.token);
  const storage = options.storage ?? createRedisStorage(options.env ?? process.env, error => app.logger.error("Redis connection error", error.message));
  const brain = new Brain();
  const persistence = new BrainPersistence(brain, storage, error => app.logger.error("Brain save failed", error));
  const directory = new SlackDirectory(api, brain);

  // Slack's route is installed first with its own raw-body signature verifier.
  // These parsers apply only to the existing custom webhook routes after it.
  receiver.router.use(express.json(), express.urlencoded({ extended: true }));
  const bot = new Bot({
    name: config.name, alias: config.alias, version: config.version,
    brain, router: receiver.router, transport: new SlackTransport(api, directory),
    slack: api,
    logger: {
      error: (...args) => app.logger.error(...args), warning: (...args) => app.logger.warn(...args),
      info: (...args) => app.logger.info(...args), debug: (...args) => app.logger.debug(...args),
    },
  });
  let events: SlackEvents | undefined;
  let worker: InboxWorker | undefined;
  let initialization: Promise<void> | undefined;
  let stopping: Promise<void> | undefined;
  let listening = false;
  let starting = false;
  let serverStart: Promise<import("node:http").Server> | undefined;

  app.use(async ({ body, next }) => {
    // A shared-channel event can have another origin team. Trust the signed
    // installation authorization, not the sender's workspace. Unrelated events
    // are acknowledged without dispatching or mutating the brain.
    if (!identity) return;
    const envelope = body as { team_id?: string; authorizations?: Array<{ team_id?: string; user_id?: string; is_bot?: boolean }> };
    const allowed = envelope.authorizations?.length
      ? envelope.authorizations.some(auth => auth.team_id === identity!.teamId && auth.is_bot === true && auth.user_id === identity!.botUserId)
      : envelope.team_id === identity.teamId;
    if (allowed) await next();
  });

  const accept = async (eventId: string, event: Record<string, any>): Promise<void> => {
    if (!identity || !worker) throw new Error("Event worker is not ready");
    if (["im", "mpim", "group"].includes(event.channel_type) || /^[DG]/.test(event.channel ?? "")) return;
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        storage.enqueue(inboxEvent(identity.teamId, eventId, event)),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Event inbox write timed out")), 2000); }),
      ]);
    } finally { if (timer) clearTimeout(timer); }
  };
  app.event("message", async ({ event, body }) => { await accept(body.event_id, event); });
  app.event("app_mention", async ({ event, body }) => { await accept(body.event_id, event); });
  app.event("user_change", async ({ event, body }) => { await accept(body.event_id, event); });
  app.error(async error => {
    bot.logger.error("Slack event processing failed", error);
    // Bolt otherwise treats a resolved global error handler as recovery and
    // sends the stored 200 response even though the listener failed.
    throw error;
  });

  function initialize(): Promise<void> {
    if (stopping) return Promise.reject(new Error("Bot is stopping"));
    if (!initialization) {
      initialization = (async () => {
        try {
          await storage.connect();
          await persistence.load();
          await options.beforeScripts?.(brain, bot.logger);
          identity = await api.identity();
          await directory.loadUsers();
          await options.register(bot);
          brain.emit("loaded", brain.data);
          events = new SlackEvents(bot, api, directory, storage, identity);
          worker = new InboxWorker(storage, async item => {
            if (item.event.type === "user_change") {
              if (item.event.user?.id) directory.updateUser(item.event.user);
            } else {
              // Inbox completion supplies deduplication; never pre-claim work
              // that must remain replayable after a crash.
              await events!.receive(item.team, item.event as import("./slack-adapter").SlackMessageEvent, false);
            }
          }, () => persistence.save(), bot.logger);
          persistence.start();
          ready = true;
          worker.start();
        } catch (error) {
          identity = undefined;
          // Never save after an incomplete startup or corrupt memory read.
          await storage.close();
          throw error;
        }
      })();
    }
    return initialization;
  }

  async function start(listen: number | ListenOptions = config.port) {
    if (listening || starting) throw new Error("Bot already started");
    starting = true;
    try {
      await initialize();
      if (stopping) throw new Error("Bot is stopping");
      serverStart = receiver.start(listen);
      const server = await serverStart;
      listening = true;
      return server;
    } catch (error) {
      await stop();
      throw error;
    } finally {
      starting = false;
    }
  }

  function stop(): Promise<void> {
    if (!stopping) {
      ready = false;
      stopping = (async () => {
        // Wait for initialization to settle before closing its storage socket.
        try { await initialization; } catch { return; }
        try {
          if (serverStart) await serverStart.then(() => app.stop(), () => {});
          listening = false;
        } finally {
          await worker?.stop();
          await events?.stop();
          await bot.flush();
          try {
            if (events) await persistence.close();
            else await storage.close();
          } finally { identity = undefined; }
        }
      })();
    }
    return stopping;
  }

  async function drainEvents(): Promise<void> {
    // Diagnostic/test drain: do not spin on events awaiting retry backoff.
    let previous = Infinity;
    while (worker) {
      const count = (await storage.pendingEvents()).length;
      if (!count || count >= previous) break;
      previous = count;
      await worker.tick();
      await worker.settle();
    }
    await bot.flush();
  }
  return { app, receiver, bot, brain, initialize, start, stop, drainEvents };
}

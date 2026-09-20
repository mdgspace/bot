import { App, ExpressReceiver, LogLevel } from "@slack/bolt";
import express from "express";
import type { ListenOptions } from "node:net";
import { Bot } from "./bot";
import { Brain, BrainPersistence } from "./brain";
import { createRedisStorage, type BotStorage } from "./redis-storage";
import { slackApi, type SlackApi, type SlackIdentity } from "./slack-api";
import { SlackDirectory, SlackEvents, SlackTransport } from "./slack-adapter";

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
    name: env.HUBOT_NAME || "bot",
    alias: env.HUBOT_ALIAS || undefined,
    version,
    port,
  };
}

export interface BoltBotOptions {
  config: BoltConfig;
  register(bot: Bot): void | Promise<void>;
  // Called after loading memory but before importing/registering scripts. The
  // entrypoint can restore persisted environment configuration here.
  beforeScripts?(brain: Brain): void | Promise<void>;
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
    processBeforeResponse: false,
  });
  let identity: SlackIdentity | undefined;
  const app = new App({
    receiver,
    socketMode: false,
    convoStore: false,
    logLevel: LogLevel.INFO,
    // Custom authorization avoids an auth.test call in Bolt's constructor and
    // confines this installation to the workspace authenticated at startup.
    authorize: async ({ teamId }) => {
      if (!identity || teamId !== identity.teamId) throw new Error("Slack workspace is not authorized");
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
  let initialization: Promise<void> | undefined;
  let stopping: Promise<void> | undefined;
  let listening = false;
  let starting = false;
  let serverStart: Promise<import("node:http").Server> | undefined;

  app.event("message", async ({ event, body }) => { await events?.receive(body.team_id ?? "", event); });
  app.event("app_mention", async ({ event, body }) => { await events?.receive(body.team_id ?? "", event); });
  app.event("user_change", async ({ event }) => {
    if (event.user.id) directory.updateUser({ ...event.user, id: event.user.id });
  });
  app.error(async error => { bot.logger.error("Slack event processing failed", error); });

  function initialize(): Promise<void> {
    if (stopping) return Promise.reject(new Error("Bot is stopping"));
    if (!initialization) {
      initialization = (async () => {
        try {
          await storage.connect();
          await persistence.load();
          identity = await api.identity();
          await directory.loadUsers();
          await options.beforeScripts?.(brain);
          await options.register(bot);
          brain.emit("loaded", brain.data);
          events = new SlackEvents(bot, api, directory, storage, identity);
          persistence.start();
          ready = true;
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

  return { app, receiver, bot, brain, initialize, start, stop };
}

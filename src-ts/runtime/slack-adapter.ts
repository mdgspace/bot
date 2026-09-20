import { Bot, TextMessage } from "./bot";
import type { Brain } from "./brain";
import type { EventClaims } from "./redis-storage";
import type { SlackApi, SlackChannel, SlackIdentity, SlackUser } from "./slack-api";
import type { DeliveryMethod, Envelope, Logger, OutgoingMessage, Transport, User } from "./types";

export interface SlackMessageEvent {
  type: string;
  subtype?: string;
  channel?: string;
  user?: string;
  bot_id?: string;
  text?: string;
  ts?: string;
  thread_ts?: string;
  channel_type?: string;
  hidden?: boolean;
  attachments?: Array<{ fallback?: string }>;
}

export class SlackDirectory {
  private readonly channelCache = new Map<string, { value: SlackChannel; expires: number }>();
  private readonly channelNames = new Map<string, { id: string; expires: number }>();
  constructor(private readonly api: SlackApi, private readonly brain: Brain) {}

  async loadUsers(): Promise<void> {
    let cursor: string | undefined;
    const cursors = new Set<string>();
    do {
      const page = await this.api.users(cursor);
      for (const user of page.users) if (user.id) this.updateUser(user);
      cursor = page.cursor;
      if (cursor && cursors.has(cursor)) throw new Error("Slack user pagination repeated a cursor");
      if (cursor) cursors.add(cursor);
    } while (cursor);
  }

  updateUser(user: SlackUser): User {
    return this.brain.userForId(user.id, {
      name: user.name,
      real_name: user.real_name,
      email_address: user.profile?.email,
      slack: user,
    });
  }

  async user(id: string): Promise<User> {
    if (Object.hasOwn(this.brain.data.users, id)) return this.brain.data.users[id];
    return this.updateUser(await this.api.userInfo(id));
  }

  async channel(id: string, fresh = false): Promise<SlackChannel> {
    const cached = this.channelCache.get(id);
    if (!fresh && cached && cached.expires > Date.now()) return cached.value;
    const channel = await this.api.channelInfo(id);
    // Fail closed: a partial response cannot authorize processing private text.
    if (typeof channel.is_private !== "boolean" || typeof channel.is_im !== "boolean") {
      throw new Error(`Slack channel privacy metadata is missing: ${id}`);
    }
    this.channelCache.set(id, { value: channel, expires: Date.now() + 60000 });
    return channel;
  }

  async resolve(target: string): Promise<string> {
    if (/^[CGD][A-Z0-9]+$/.test(target)) return target;
    if (/^[UW][A-Z0-9]+$/.test(target)) return this.api.openDM(target);
    if (target.startsWith("@")) {
      const user = this.brain.userForName(target.slice(1));
      if (!user) throw new Error(`Unknown Slack user: ${target}`);
      return this.api.openDM(user.id);
    }
    const name = target.replace(/^#/, "");
    const cached = this.channelNames.get(name);
    if (cached && cached.expires > Date.now()) return cached.id;
    let cursor: string | undefined;
    const cursors = new Set<string>();
    do {
      const page = await this.api.channels(cursor);
      for (const channel of page.channels) {
        if (channel.name) this.channelNames.set(channel.name, { id: channel.id, expires: Date.now() + 60000 });
        if (channel.name === name) return channel.id;
      }
      cursor = page.cursor;
      if (cursor && cursors.has(cursor)) throw new Error("Slack channel pagination repeated a cursor");
      if (cursor) cursors.add(cursor);
    } while (cursor);
    throw new Error(`Unknown Slack channel: ${target}`);
  }
}

export class SlackTransport implements Transport {
  constructor(private readonly api: SlackApi, private readonly directory: SlackDirectory) {}

  async deliver(method: DeliveryMethod, envelope: Envelope, messages: OutgoingMessage[]): Promise<void> {
    if (messages.every(message => message === "")) return;
    const target = envelope.room || envelope.id;
    if (!target) throw new Error("Cannot send a Slack message without a room or user ID");
    const channel = await this.directory.resolve(target);
    for (const message of messages) {
      if (message === "") continue;
      const payload = typeof message === "string" ? { text: message } : { ...message };
      if (method === "reply" && !channel.startsWith("D") && envelope.user) {
        payload.text = `<@${envelope.user.id}>: ${payload.text ?? ""}`;
      }
      // The old adapter's emote inherited send behavior; don't change formatting.
      await this.api.postMessage({ link_names: true, thread_ts: envelope.message?.thread_ts, ...payload, channel });
    }
  }
}

export async function normalizeSlackText(text: string, identity: SlackIdentity, botName: string, directory: SlackDirectory, logger: Logger): Promise<string> {
  const pattern = /<([@#!]?)([^>|]+)(?:\|([^>]*))?>/g;
  let result = "", cursor = 0;
  for (const match of text.matchAll(pattern)) {
    result += text.slice(cursor, match.index);
    const [original, kind, id, label] = match;
    let replacement = original;
    try {
      if (kind === "@") {
        // A new app can have a different username while keeping configured commands.
        replacement = `@${id === identity.botUserId ? botName : label || (await directory.user(id)).name}`;
      } else if (kind === "#") {
        replacement = `#${label || (await directory.channel(id)).name || id}`;
      } else if (kind === "!") {
        replacement = ["here", "channel", "everyone"].includes(id) ? `@${id}` : label || original;
      } else {
        const link = id.replace(/^mailto:/, "");
        replacement = label && !link.includes(label) ? `${label} (${link})` : link;
      }
    } catch {
      // Preserve unresolved markup, as the old adapter did, without logging text.
      logger.warning(`Unable to resolve Slack reference ${kind}${id}`);
    }
    result += replacement;
    cursor = match.index + original.length;
  }
  return (result + text.slice(cursor)).replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

export class SlackEvents {
  private pending: Promise<void> = Promise.resolve();
  private accepting = true;
  constructor(
    private readonly bot: Bot,
    private readonly api: SlackApi,
    private readonly directory: SlackDirectory,
    private readonly claims: EventClaims,
    private readonly identity: SlackIdentity,
  ) {}

  receive(team: string, event: SlackMessageEvent): Promise<void> {
    if (!this.accepting) return Promise.resolve();
    // Serial dispatch keeps user.room stable and preserves mutation ordering.
    const task = this.pending.then(() => this.dispatch(team, event));
    this.pending = task.catch(() => {});
    return task;
  }

  async stop(): Promise<void> { this.accepting = false; await this.pending; }

  private async dispatch(team: string, event: SlackMessageEvent): Promise<void> {
    if (team !== this.identity.teamId || !["message", "app_mention"].includes(event.type)) return;
    if (!event.channel || !event.ts || event.hidden || event.user === "USLACKBOT" || event.user === this.identity.botUserId || event.bot_id === this.identity.botId) return;
    if (event.subtype && !["bot_message", "thread_broadcast", "me_message"].includes(event.subtype)) return;
    // Do not even look up users or normalize text in known private conversations.
    if (["im", "mpim", "group"].includes(event.channel_type ?? "") || /^[DG]/.test(event.channel)) return;
    const channel = await this.directory.channel(event.channel, true);
    if (channel.is_private || channel.is_im || channel.is_mpim) return;
    const userId = event.user || (event.bot_id ? await this.api.botUserId(event.bot_id) : undefined);
    if (!userId || userId === this.identity.botUserId || userId === "USLACKBOT") return;
    const user = await this.directory.user(userId);
    const fallback = (event.attachments ?? []).map(attachment => attachment.fallback ?? "").join("\n");
    const text = await normalizeSlackText((event.text ?? "") + (fallback ? `\n${fallback}` : ""), this.identity, this.bot.name, this.directory, this.bot.logger);
    // Claim only once preprocessing succeeds; overlap and retry IDs may differ,
    // but the underlying workspace/channel/message timestamp stays the same.
    if (!await this.claims.claim(team, event.channel, event.ts)) return;
    user.room = event.channel;
    const message = new TextMessage({ ...user, room: event.channel, pm: false }, text, event.channel, event.thread_ts);
    message.channel = channel;
    await this.bot.receive(message);
  }
}

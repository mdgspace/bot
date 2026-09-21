import { createHash } from "node:crypto";
import { createClient } from "redis";
import type { BrainStorage } from "./brain";
import type { EventInbox, InboxEvent } from "./event-inbox";

export interface EventClaims {
  claim(team: string, channel: string, timestamp: string): Promise<boolean>;
}

export interface BotStorage extends BrainStorage, EventClaims, EventInbox {
  readonly ready: boolean;
  connect(): Promise<void>;
}

export function redisConfiguration(env: NodeJS.ProcessEnv) {
  const raw = env.REDISTOGO_URL ?? env.REDISCLOUD_URL ?? env.BOXEN_REDIS_URL ?? env.REDIS_URL ?? "redis://localhost:6379";
  // The old brain used the URL *path*, including any query, as the key prefix.
  // It did not select a Redis database. Passing that path to node-redis would
  // silently read a different database (or reject a nonnumeric prefix).
  const url = new URL(raw);
  if (!["redis:", "rediss:"].includes(url.protocol)) throw new Error("Expected a redis:// or rediss:// brain URL");
  // Extract the encoded path verbatim after validating the URL. WHATWG URL
  // normalizes dot segments, which would change an existing brain's key.
  const path = raw.trim().match(/^[^:]+:\/\/[^/?#]*([^#]*)/)?.[1] ?? "";
  // Strip only the leading slash; embedded slashes intentionally remain in the legacy key.
  const prefix = path.replace("/", "") || "hubot";
  url.pathname = "/0";
  url.search = "";
  url.hash = "";
  // Legacy providers used a placeholder username; AUTH used only the password.
  url.username = "";
  return { url: url.toString(), storageKey: `${prefix}:storage` };
}

export interface RedisConnection {
  readonly isOpen: boolean;
  readonly isReady: boolean;
  connect(): Promise<unknown>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: { NX?: true; EX?: number }): Promise<string | null>;
  close(): Promise<void>;
  destroy(): void;
  eval(script: string, options: { keys: string[]; arguments: string[] }): Promise<unknown>;
  zRange(key: string, start: number, stop: number): Promise<string[]>;
  hmGet(key: string, fields: string[]): Promise<(string | null)[]>;
}

export class RedisStorage implements BotStorage {
  constructor(private readonly client: RedisConnection, readonly storageKey: string) {}

  get ready(): boolean { return this.client.isReady; }

  async connect(): Promise<void> {
    let timeout: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        this.client.connect(),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => {
            if (this.client.isOpen) this.client.destroy();
            reject(new Error("Redis startup timed out"));
          }, 30000);
        }),
      ]);
    } finally { if (timeout) clearTimeout(timeout); }
  }
  read(): Promise<string | null> { return this.client.get(this.storageKey); }
  async write(serialized: string): Promise<void> { await this.client.set(this.storageKey, serialized); }

  async claim(team: string, channel: string, timestamp: string): Promise<boolean> {
    const id = createHash("sha256").update(JSON.stringify([team, channel, timestamp])).digest("hex");
    // Separate keys: never add adapter bookkeeping to the legacy brain JSON.
    return await this.client.set(`${this.storageKey}:slack-event:${id}`, "1", { NX: true, EX: 86400 }) === "OK";
  }

  async enqueue(event: InboxEvent): Promise<void> {
    await this.client.eval(`
      if redis.call('EXISTS', KEYS[3]) == 1 then return 0 end
      if redis.call('HSETNX', KEYS[1], ARGV[1], ARGV[2]) == 1 then
        redis.call('ZADD', KEYS[2], redis.call('INCR', KEYS[4]), ARGV[1])
      end
      return 1`, {
      keys: [`${this.storageKey}:inbox`, `${this.storageKey}:inbox-order`,
        `${this.storageKey}:slack-event:${event.id}`, `${this.storageKey}:inbox-sequence`],
      arguments: [event.id, JSON.stringify(event)],
    });
  }

  async pendingEvents(): Promise<InboxEvent[]> {
    const ids = await this.client.zRange(`${this.storageKey}:inbox-order`, 0, -1);
    if (!ids.length) return [];
    const values = await this.client.hmGet(`${this.storageKey}:inbox`, ids);
    return values.filter((value): value is string => value !== null).map(value => JSON.parse(value) as InboxEvent);
  }

  async completeEvent(id: string): Promise<void> {
    await this.client.eval(`
      redis.call('SET', KEYS[3], '1', 'EX', 86400)
      redis.call('HDEL', KEYS[1], ARGV[1])
      redis.call('ZREM', KEYS[2], ARGV[1])
      return 1`, {
      keys: [`${this.storageKey}:inbox`, `${this.storageKey}:inbox-order`, `${this.storageKey}:slack-event:${id}`],
      arguments: [id],
    });
  }

  async close(): Promise<void> {
    if (this.client.isOpen) await this.client.close();
  }
}

/** Construction is offline. A socket opens only when connect() is called. */
export function createRedisStorage(env: NodeJS.ProcessEnv, onError: (error: Error) => void): RedisStorage {
  const config = redisConfiguration(env);
  const client = createClient({
    url: config.url,
    disableOfflineQueue: true,
    socket: { connectTimeout: 10000, reconnectStrategy: retries => Math.min(100 * 2 ** Math.min(retries, 5), 3000) },
  });
  client.on("error", onError);
  return new RedisStorage(client, config.storageKey);
}

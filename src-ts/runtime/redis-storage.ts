import { createHash } from "node:crypto";
import { createClient } from "redis";
import type { BrainStorage } from "./brain";
import { inboxChannelKey, LeaseLostError, type EventInbox, type FailureResult, type InboxEvent } from "./event-inbox";

export interface EventClaims {
  claim(team: string, channel: string, timestamp: string): Promise<boolean>;
}

export interface BotStorage extends BrainStorage, EventClaims, EventInbox {
  readonly ready: boolean;
  connect(): Promise<void>;
  writeIfLease(serialized: string, owner: string): Promise<void>;
}

export function redisConfiguration(env: NodeJS.ProcessEnv) {
  const raw = [env.REDISTOGO_URL, env.REDISCLOUD_URL, env.BOXEN_REDIS_URL, env.REDIS_URL]
    .map(value => value?.trim()).find((value): value is string => Boolean(value)) ?? "redis://localhost:6379";
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

  async writeIfLease(serialized: string, owner: string): Promise<void> {
    const written = Number(await this.client.eval(`
      if redis.call('GET', KEYS[2]) ~= ARGV[1] then return 0 end
      redis.call('SET', KEYS[1], ARGV[2])
      return 1`, {
      keys: [this.storageKey, `${this.storageKey}:inbox-worker`],
      arguments: [owner, serialized],
    }));
    if (written !== 1) throw new LeaseLostError();
  }

  async claim(team: string, channel: string, timestamp: string): Promise<boolean> {
    const id = createHash("sha256").update(JSON.stringify([team, channel, timestamp])).digest("hex");
    // Separate keys: never add adapter bookkeeping to the legacy brain JSON.
    return await this.client.set(`${this.storageKey}:slack-event:${id}`, "1", { NX: true, EX: 86400 }) === "OK";
  }

  /**
   * Rebuild only the scheduler's derived indexes. The durable payload/order,
   * retry counts, dead letters, dedupe keys and legacy brain are untouched.
   * This also upgrades inbox rows written by the pre-index scheduler.
   */
  async prepareInbox(): Promise<void> {
    const base = this.storageKey;
    await this.client.eval(`
      redis.call('DEL', KEYS[2], KEYS[3], KEYS[4], KEYS[5], KEYS[6], KEYS[7])
      local last = redis.call('ZRANGE', KEYS[1], -1, -1, 'WITHSCORES')
      if last[2] then
        local current = tonumber(redis.call('GET', KEYS[8]) or '0')
        if tonumber(last[2]) > current then redis.call('SET', KEYS[8], last[2]) end
      end
      return 1`, {
      keys: [`${base}:inbox-order`, `${base}:inbox-heads`, `${base}:inbox-tails`,
        `${base}:inbox-next`, `${base}:inbox-scores`, `${base}:inbox-ready`,
        `${base}:inbox-delayed`, `${base}:inbox-sequence`],
      arguments: [],
    });

    let offset = 0;
    while (true) {
      const ids = await this.client.zRange(`${base}:inbox-order`, offset, offset + 63);
      if (!ids.length) break;
      const values = await this.client.hmGet(`${base}:inbox`, ids);
      const arguments_: string[] = [];
      for (let index = 0; index < ids.length; index++) {
        const value = values[index];
        if (value === null) throw new Error(`Inbox order references missing event ${ids[index]}`);
        const event = JSON.parse(value) as InboxEvent;
        arguments_.push(ids[index], inboxChannelKey(event), String(offset + index + 1));
      }
      await this.client.eval(`
        for index = 1, #ARGV, 3 do
          local id, queue, score = ARGV[index], ARGV[index + 1], ARGV[index + 2]
          local tail = redis.call('HGET', KEYS[2], queue)
          redis.call('HSET', KEYS[4], id, score)
          if tail then
            redis.call('HSET', KEYS[3], tail, id)
          else
            redis.call('HSET', KEYS[1], queue, id)
            redis.call('ZADD', KEYS[5], score, queue)
          end
          redis.call('HSET', KEYS[2], queue, id)
        end
        return #ARGV / 3`, {
        keys: [`${base}:inbox-heads`, `${base}:inbox-tails`, `${base}:inbox-next`,
          `${base}:inbox-scores`, `${base}:inbox-ready`],
        arguments: arguments_,
      });
      offset += ids.length;
      if (ids.length < 64) break;
    }
  }

  async enqueue(event: InboxEvent): Promise<void> {
    await this.client.eval(`
      if redis.call('EXISTS', KEYS[3]) == 1 then return 0 end
      if redis.call('HSETNX', KEYS[1], ARGV[1], ARGV[2]) == 1 then
        local score = redis.call('INCR', KEYS[4])
        redis.call('ZADD', KEYS[2], score, ARGV[1])
        redis.call('HSET', KEYS[8], ARGV[1], score)
        local tail = redis.call('HGET', KEYS[6], ARGV[3])
        if tail then
          redis.call('HSET', KEYS[7], tail, ARGV[1])
        else
          redis.call('HSET', KEYS[5], ARGV[3], ARGV[1])
          redis.call('ZADD', KEYS[9], score, ARGV[3])
        end
        redis.call('HSET', KEYS[6], ARGV[3], ARGV[1])
      end
      return 1`, {
      keys: [`${this.storageKey}:inbox`, `${this.storageKey}:inbox-order`,
        `${this.storageKey}:slack-event:${event.id}`, `${this.storageKey}:inbox-sequence`,
        `${this.storageKey}:inbox-heads`, `${this.storageKey}:inbox-tails`,
        `${this.storageKey}:inbox-next`, `${this.storageKey}:inbox-scores`,
        `${this.storageKey}:inbox-ready`],
      arguments: [event.id, JSON.stringify(event), inboxChannelKey(event)],
    });
  }

  async pendingEvents(limit = 64): Promise<InboxEvent[]> {
    const stop = Math.max(1, Math.floor(limit)) - 1;
    const ids = await this.client.zRange(`${this.storageKey}:inbox-order`, 0, stop);
    if (!ids.length) return [];
    const values = await this.client.hmGet(`${this.storageKey}:inbox`, ids);
    return values.filter((value): value is string => value !== null).map(value => JSON.parse(value) as InboxEvent);
  }

  async readyEvents(limit = 64): Promise<InboxEvent[]> {
    const result = await this.client.eval(`
      local due = redis.call('ZRANGEBYSCORE', KEYS[2], '-inf', ARGV[1], 'LIMIT', 0, ARGV[2])
      for _, queue in ipairs(due) do
        local head = redis.call('HGET', KEYS[3], queue)
        if head then
          redis.call('ZADD', KEYS[1], redis.call('HGET', KEYS[4], head) or ARGV[1], queue)
        end
        redis.call('ZREM', KEYS[2], queue)
      end
      local queues = redis.call('ZRANGE', KEYS[1], 0, tonumber(ARGV[2]) - 1)
      local payloads = {}
      for _, queue in ipairs(queues) do
        local head = redis.call('HGET', KEYS[3], queue)
        local payload = head and redis.call('HGET', KEYS[5], head)
        if payload then table.insert(payloads, payload) else redis.call('ZREM', KEYS[1], queue) end
      end
      return payloads`, {
      keys: [`${this.storageKey}:inbox-ready`, `${this.storageKey}:inbox-delayed`,
        `${this.storageKey}:inbox-heads`, `${this.storageKey}:inbox-scores`, `${this.storageKey}:inbox`],
      arguments: [String(Date.now()), String(Math.max(1, Math.floor(limit)))],
    }) as string[];
    return result.map(value => JSON.parse(value) as InboxEvent);
  }

  async channelEvents(head: InboxEvent, limit = 16): Promise<InboxEvent[]> {
    const result = await this.client.eval(`
      if redis.call('HGET', KEYS[1], ARGV[1]) ~= ARGV[2] then return {} end
      local payloads, id = {}, ARGV[2]
      for _ = 1, tonumber(ARGV[3]) do
        local payload = redis.call('HGET', KEYS[3], id)
        if not payload then break end
        table.insert(payloads, payload)
        id = redis.call('HGET', KEYS[2], id)
        if not id then break end
      end
      return payloads`, {
      keys: [`${this.storageKey}:inbox-heads`, `${this.storageKey}:inbox-next`, `${this.storageKey}:inbox`],
      arguments: [inboxChannelKey(head), head.id, String(Math.max(1, Math.floor(limit)))],
    }) as string[];
    return result.map(value => JSON.parse(value) as InboxEvent);
  }

  async completeEvent(event: InboxEvent, owner: string): Promise<void> {
    const id = event.id;
    const result = Number(await this.client.eval(`
      if redis.call('GET', KEYS[11]) ~= ARGV[3] then return -1 end
      if redis.call('HGET', KEYS[5], ARGV[2]) ~= ARGV[1] then return 0 end
      local next = redis.call('HGET', KEYS[7], ARGV[1])
      local nextScore = next and redis.call('HGET', KEYS[8], next)
      if next and not nextScore then return redis.error_reply('missing inbox score for ' .. next) end
      redis.call('SET', KEYS[3], '1', 'EX', 86400)
      redis.call('HDEL', KEYS[1], ARGV[1])
      redis.call('ZREM', KEYS[2], ARGV[1])
      redis.call('HDEL', KEYS[4], ARGV[1])
      redis.call('HDEL', KEYS[7], ARGV[1])
      redis.call('HDEL', KEYS[8], ARGV[1])
      if next then
        redis.call('HSET', KEYS[5], ARGV[2], next)
        redis.call('ZADD', KEYS[9], nextScore, ARGV[2])
      else
        redis.call('HDEL', KEYS[5], ARGV[2])
        redis.call('HDEL', KEYS[6], ARGV[2])
        redis.call('ZREM', KEYS[9], ARGV[2])
        redis.call('ZREM', KEYS[10], ARGV[2])
      end
      return 1`, {
      keys: [`${this.storageKey}:inbox`, `${this.storageKey}:inbox-order`, `${this.storageKey}:slack-event:${id}`,
        `${this.storageKey}:inbox-retries`, `${this.storageKey}:inbox-heads`, `${this.storageKey}:inbox-tails`,
        `${this.storageKey}:inbox-next`, `${this.storageKey}:inbox-scores`, `${this.storageKey}:inbox-ready`,
        `${this.storageKey}:inbox-delayed`, `${this.storageKey}:inbox-worker`],
      arguments: [id, inboxChannelKey(event), owner],
    }));
    if (result === -1) throw new LeaseLostError();
    if (result !== 1) throw new Error(`Inbox event ${id} is no longer the channel head`);
  }

  async failEvent(event: InboxEvent, reason: string, maxAttempts: number, owner: string): Promise<FailureResult> {
    const id = event.id;
    const result = await this.client.eval(`
      if redis.call('GET', KEYS[13]) ~= ARGV[6] then return {-1, 0, 0} end
      local payload = redis.call('HGET', KEYS[1], ARGV[1])
      if not payload or redis.call('HGET', KEYS[7], ARGV[5]) ~= ARGV[1] then return {0, 0, 0} end
      local attempts = redis.call('HINCRBY', KEYS[3], ARGV[1], 1)
      if attempts < tonumber(ARGV[3]) then
        local exponent = math.min(attempts - 1, 6)
        local retryAt = tonumber(ARGV[4]) + math.min(5000 * (2 ^ exponent), 300000)
        redis.call('ZREM', KEYS[11], ARGV[5])
        redis.call('ZADD', KEYS[12], retryAt, ARGV[5])
        return {attempts, 0, retryAt}
      end
      local next = redis.call('HGET', KEYS[9], ARGV[1])
      local nextScore = next and redis.call('HGET', KEYS[10], next)
      if next and not nextScore then return redis.error_reply('missing inbox score for ' .. next) end
      local dead = cjson.encode({event=cjson.decode(payload), attempts=attempts,
        reason=ARGV[2], failedAt=ARGV[4]})
      redis.call('HSET', KEYS[4], ARGV[1], dead)
      redis.call('ZADD', KEYS[5], ARGV[4], ARGV[1])
      redis.call('SET', KEYS[6], '1', 'EX', 86400)
      redis.call('HDEL', KEYS[1], ARGV[1])
      redis.call('ZREM', KEYS[2], ARGV[1])
      redis.call('HDEL', KEYS[3], ARGV[1])
      redis.call('HDEL', KEYS[9], ARGV[1])
      redis.call('HDEL', KEYS[10], ARGV[1])
      redis.call('ZREM', KEYS[12], ARGV[5])
      if next then
        redis.call('HSET', KEYS[7], ARGV[5], next)
        redis.call('ZADD', KEYS[11], nextScore, ARGV[5])
      else
        redis.call('HDEL', KEYS[7], ARGV[5])
        redis.call('HDEL', KEYS[8], ARGV[5])
        redis.call('ZREM', KEYS[11], ARGV[5])
      end
      local excess = redis.call('ZCARD', KEYS[5]) - 1000
      if excess > 0 then
        local stale = redis.call('ZRANGE', KEYS[5], 0, excess - 1)
        for _, staleId in ipairs(stale) do redis.call('HDEL', KEYS[4], staleId) end
        redis.call('ZREMRANGEBYRANK', KEYS[5], 0, excess - 1)
      end
      return {attempts, 1, 0}`, {
      keys: [`${this.storageKey}:inbox`, `${this.storageKey}:inbox-order`, `${this.storageKey}:inbox-retries`,
        `${this.storageKey}:dead-letter`, `${this.storageKey}:dead-letter-order`, `${this.storageKey}:slack-event:${id}`,
        `${this.storageKey}:inbox-heads`, `${this.storageKey}:inbox-tails`, `${this.storageKey}:inbox-next`,
        `${this.storageKey}:inbox-scores`, `${this.storageKey}:inbox-ready`, `${this.storageKey}:inbox-delayed`,
        `${this.storageKey}:inbox-worker`],
      arguments: [id, reason, String(maxAttempts), String(Date.now()), inboxChannelKey(event), owner],
    }) as [number, number, number];
    if (Number(result[0]) === -1) throw new LeaseLostError();
    return { attempts: Number(result[0]), deadLettered: Number(result[1]) === 1,
      ...(Number(result[2]) ? { retryAt: Number(result[2]) } : {}) };
  }

  async acquireLease(owner: string, ttlSeconds: number): Promise<boolean> {
    return await this.client.set(`${this.storageKey}:inbox-worker`, owner, { NX: true, EX: ttlSeconds }) === "OK";
  }

  async renewLease(owner: string, ttlSeconds: number): Promise<boolean> {
    return Number(await this.client.eval(`
      if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
      redis.call('EXPIRE', KEYS[1], ARGV[2])
      return 1`, {
      keys: [`${this.storageKey}:inbox-worker`], arguments: [owner, String(ttlSeconds)],
    })) === 1;
  }

  async releaseLease(owner: string): Promise<void> {
    await this.client.eval(`
      if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end
      return 0`, { keys: [`${this.storageKey}:inbox-worker`], arguments: [owner] });
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

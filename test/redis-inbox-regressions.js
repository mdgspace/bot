"use strict";

// Explicit opt-in, loopback Redis only. No Slack connection, no shared brain key,
// and cleanup deletes only this test's unique namespace (never FLUSHDB).
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { randomUUID } = require("node:crypto");
const { createClient } = require("redis");
const { RedisStorage } = require("../scripts/runtime/redis-storage");
const { inboxEvent } = require("../scripts/runtime/event-inbox");

test("real Redis atomically accepts duplicates, retains pending work and remembers completion", async t => {
  assert(process.env.TEST_REDIS_URL, "Set TEST_REDIS_URL to a disposable local Redis instance");
  const url = new URL(process.env.TEST_REDIS_URL);
  assert(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname), "Only loopback Redis is allowed in this test");
  const key = `bot-inbox-test:${randomUUID()}`;
  const first = inboxEvent("T1", "Ev1", { type: "message", channel: "C1", ts: "1", text: "hello" });
  const overlap = inboxEvent("T1", "Ev2", { type: "app_mention", channel: "C1", ts: "1", text: "hello" });
  const second = inboxEvent("T1", "Ev3", { type: "message", channel: "C1", ts: "2" });
  const client = createClient({ url: url.toString(), socket: { connectTimeout: 3000, reconnectStrategy: false } });
  client.on("error", () => {});
  const storage = new RedisStorage(client, key);
  await storage.connect();
  t.after(async () => {
    try {
      if (!client.isOpen) await client.connect();
      await client.del([key, `${key}:inbox`, `${key}:inbox-order`, `${key}:inbox-sequence`,
        `${key}:slack-event:${first.id}`, `${key}:slack-event:${second.id}`]);
    } finally { if (client.isOpen) await client.close(); }
  });
  await storage.write('{"users":{},"_private":{"keep":true}}');
  await storage.enqueue(first);
  await Promise.all(Array.from({ length: 30 }, () => storage.enqueue(overlap)));
  await storage.enqueue(second);
  assert.deepEqual((await storage.pendingEvents()).map(item => item.id), [first.id, second.id]);
  assert.equal((await storage.pendingEvents())[0].event.type, "message");
  await storage.completeEvent(first.id);
  assert((await client.ttl(`${key}:slack-event:${first.id}`)) > 86000);
  await storage.close();
  await storage.connect();
  await storage.enqueue(overlap);
  assert.deepEqual(await storage.pendingEvents(), [second]);
  await storage.completeEvent(second.id);
  assert.deepEqual(await storage.pendingEvents(), []);
  assert.deepEqual(JSON.parse(await storage.read()), { users: {}, _private: { keep: true } });
});

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
  const doomed = inboxEvent("T1", "Ev4", { type: "message", channel: "C2", ts: "3" });
  const healthy = inboxEvent("T1", "Healthy", { type: "message", channel: "CHEALTHY", ts: "90" });
  const client = createClient({ url: url.toString(), socket: { connectTimeout: 3000, reconnectStrategy: false } });
  client.on("error", () => {});
  const storage = new RedisStorage(client, key);
  await storage.connect();
  t.after(async () => {
    try {
      if (!client.isOpen) await client.connect();
      await client.del([key, `${key}:inbox`, `${key}:inbox-order`, `${key}:inbox-sequence`,
        `${key}:inbox-retries`, `${key}:dead-letter`, `${key}:dead-letter-order`, `${key}:inbox-worker`,
        `${key}:inbox-heads`, `${key}:inbox-tails`, `${key}:inbox-next`, `${key}:inbox-scores`,
        `${key}:inbox-ready`, `${key}:inbox-delayed`,
        `${key}:slack-event:${first.id}`, `${key}:slack-event:${second.id}`, `${key}:slack-event:${doomed.id}`,
        `${key}:slack-event:${healthy.id}`]);
    } finally { if (client.isOpen) await client.close(); }
  });
  await storage.write('{"users":{},"_private":{"keep":true}}');
  await storage.enqueue(first);
  await Promise.all(Array.from({ length: 30 }, () => storage.enqueue(overlap)));
  await storage.enqueue(second);
  assert.deepEqual((await storage.pendingEvents()).map(item => item.id), [first.id, second.id]);
  assert.equal((await storage.pendingEvents())[0].event.type, "message");
  // Rebuild derived scheduling indexes exactly as an upgrade from the earlier
  // durable-inbox release would, without changing payloads or their order.
  await client.del([`${key}:inbox-heads`, `${key}:inbox-tails`, `${key}:inbox-next`,
    `${key}:inbox-scores`, `${key}:inbox-ready`, `${key}:inbox-delayed`]);
  await storage.prepareInbox();
  assert.deepEqual((await storage.readyEvents()).map(item => item.id), [first.id]);
  assert.deepEqual((await storage.channelEvents(first)).map(item => item.id), [first.id, second.id]);
  await storage.completeEvent(first);
  assert((await client.ttl(`${key}:slack-event:${first.id}`)) > 86000);
  await storage.close();
  await storage.connect();
  await storage.enqueue(overlap);
  assert.deepEqual(await storage.pendingEvents(), [second]);
  await storage.completeEvent(second);
  assert.deepEqual(await storage.pendingEvents(), []);
  await storage.enqueue(doomed);
  const retry = await storage.failEvent(doomed, "still retrying", 2);
  assert.equal(retry.attempts, 1); assert.equal(retry.deadLettered, false); assert(retry.retryAt > Date.now());
  assert.deepEqual(await storage.failEvent(doomed, "missing_scope", 2), { attempts: 2, deadLettered: true });
  assert.deepEqual(await storage.pendingEvents(), []);
  const dead = JSON.parse(await client.hGet(`${key}:dead-letter`, doomed.id));
  assert.equal(dead.event.id, doomed.id);
  assert.equal(dead.attempts, 2);
  assert.equal(dead.reason, "missing_scope");
  assert.equal(await storage.acquireLease("owner-one", 15), true);
  assert.equal(await storage.acquireLease("owner-two", 15), false);
  assert.equal(await storage.renewLease("owner-two", 15), false);
  assert.equal(await storage.renewLease("owner-one", 15), true);
  await storage.releaseLease("owner-two");
  assert.equal(await storage.acquireLease("owner-two", 15), false);
  await storage.releaseLease("owner-one");
  assert.equal(await storage.acquireLease("owner-two", 15), true);
  await storage.releaseLease("owner-two");
  const blocked = Array.from({ length: 70 }, (_, i) => inboxEvent("T1", `Blocked${i}`,
    { type: "message", channel: "CBLOCKED", ts: String(10 + i) }));
  for (const item of blocked) await storage.enqueue(item);
  await storage.enqueue(healthy);
  await storage.failEvent(blocked[0], "temporary", 2);
  assert((await storage.readyEvents()).some(item => item.id === healthy.id),
    "a delayed channel with more than one read window must not hide later channels");
  await storage.completeEvent(healthy);
  const backlog = Array.from({ length: 70 }, (_, i) => inboxEvent("T1", `Backlog${i}`,
    { type: "message", channel: `C${i}`, ts: String(100 + i) }));
  for (const item of backlog) await storage.enqueue(item);
  assert.equal((await storage.pendingEvents(10)).length, 10);
  assert.deepEqual(JSON.parse(await storage.read()), { users: {}, _private: { keep: true } });
});

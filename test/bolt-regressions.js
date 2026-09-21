"use strict";

const assert = require("node:assert/strict");
const { test, mock, before, after } = require("node:test");
const http = require("node:http");
const net = require("node:net");
const { createHmac } = require("node:crypto");
const { setImmediate: nextTurn } = require("node:timers/promises");
const { Brain } = require("../scripts/runtime/brain");
const { Bot } = require("../scripts/runtime/bot");
const { RedisStorage, redisConfiguration, createRedisStorage } = require("../scripts/runtime/redis-storage");
const { SlackDirectory, SlackEvents, SlackTransport, normalizeSlackText } = require("../scripts/runtime/slack-adapter");
const { slackApi } = require("../scripts/runtime/slack-api");
const { createBoltBot, boltConfiguration } = require("../scripts/runtime/bolt-app");

// Only loopback HTTP is allowed. Slack and Redis are always injected fakes.
before(() => {
  const connect = net.Socket.prototype.connect;
  mock.method(net.Socket.prototype, "connect", function (...args) {
    const options = Array.isArray(args[0]) ? args[0][0] : args[0];
    assert(["127.0.0.1", "::1", "localhost"].includes(options?.host), "External network disabled in Bolt tests");
    return connect.apply(this, args);
  });
  mock.method(globalThis, "fetch", async () => { throw new Error("External fetch disabled in Bolt tests"); });
});
after(() => mock.restoreAll());

const identity = { teamId: "T1", botUserId: "UBOT", botId: "BBOT" };
const config = { token: "xoxb-offline-test", signingSecret: "offline-test-secret", name: "bot", version: "test", port: 8080 };
const logger = { error() {}, warning() {}, info() {}, debug() {} };
function savedBrain() {
  return { users: { U1: { id: "U1", name: "alice", roles: ["maintainer"], msgcount: 3, words: { hello: 2 }, custom: true } }, _private: { scorefield: { alice: 7 } }, seen: { alice: { chan: "C1", date: 123 } }, extra: "keep" };
}
function fakeApi() {
  const calls = [], posts = [];
  return {
    calls, posts,
    async identity() { calls.push(["identity"]); return identity; },
    async userInfo(id) { calls.push(["user", id]); return { id, name: id === "U1" ? "alice" : "bob", profile: { email: "test@example.invalid" } }; },
    async users() { return { users: [] }; },
    async botInfo(id) { calls.push(["bot", id]); return { id, name: "other-bot", user_id: "UOTHERBOT" }; },
    async channelInfo(id) { calls.push(["channel", id]); return { id, name: "general", is_private: false, is_im: false }; },
    async channels(cursor) { calls.push(["channels", cursor]); return { channels: [{ id: "C1", name: "general" }] }; },
    async openDM(user) { calls.push(["dm", user]); return "D1"; },
    async postMessage(payload) { posts.push(payload); },
  };
}
function fakeStorage(value = JSON.stringify(savedBrain())) {
  const claims = new Set();
  const inbox = new Map();
  return {
    connects: 0, closes: 0, writes: [], claims, inbox, value, ready: true,
    async connect() { this.connects++; },
    async read() { return this.value; },
    async write(value) { this.writes.push(value); this.value = value; },
    async close() { this.closes++; },
    async claim(...key) { const id = JSON.stringify(key); if (claims.has(id)) return false; claims.add(id); return true; },
    async enqueue(item) { if (!claims.has(item.id) && !inbox.has(item.id)) inbox.set(item.id, structuredClone(item)); },
    async pendingEvents() { return [...inbox.values()]; },
    async completeEvent(id) { claims.add(id); inbox.delete(id); },
  };
}
function setup(overrides = {}) {
  const api = overrides.api || fakeApi(), storage = overrides.storage || fakeStorage();
  const service = createBoltBot({ config, api, storage, register: bot => require("../scripts/ping")(bot), ...overrides });
  return { ...service, api, storage };
}
function adapterSetup() {
  const brain = new Brain(); brain.restore(JSON.stringify(savedBrain()));
  const api = fakeApi(), storage = fakeStorage();
  const directory = new SlackDirectory(api, brain);
  const bot = new Bot({ name: "bot", version: "test", brain, logger, router: {}, transport: new SlackTransport(api, directory) });
  const events = new SlackEvents(bot, api, directory, storage, identity);
  return { brain, api, storage, directory, bot, events };
}
function event(overrides = {}) { return { type: "message", user: "U1", channel: "C1", ts: "123.456", text: "<@UBOT> ping", ...overrides }; }
async function dispatch(service, incoming, team = "T1") {
  let acknowledged = false;
  await service.app.processEvent({ body: { type: "event_callback", team_id: team, event_id: "Ev" + Math.random(), event: incoming }, ack: async () => { acknowledged = true; } });
  await service.drainEvents();
  await service.bot.flush();
  return acknowledged;
}
function request(server, path, body, headers = {}, method = "POST") {
  return new Promise((resolve, reject) => {
    const raw = typeof body === "string" ? body : JSON.stringify(body);
    const req = http.request({ hostname: "127.0.0.1", port: server.address().port, path, method,
      headers: { "content-type": "application/json", "content-length": Buffer.byteLength(raw), ...headers } }, res => {
      let text = ""; res.setEncoding("utf8"); res.on("data", chunk => { text += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, text })); res.on("error", reject);
    });
    req.on("error", reject); req.end(raw);
  });
}
function signature(body, timestamp = Math.floor(Date.now() / 1000)) {
  return { "x-slack-request-timestamp": String(timestamp), "x-slack-signature": "v0=" + createHmac("sha256", config.signingSecret).update(`v0:${timestamp}:${JSON.stringify(body)}`).digest("hex") };
}

test("public message bursts reuse channel metadata and share concurrent lookups", async () => {
  const { api, events, directory } = adapterSetup();
  await Promise.all(Array.from({ length: 20 }, (_, i) => events.receive("T1", event({ ts: String(i), channel_type: "channel" }))));
  assert.equal(api.calls.filter(call => call[0] === "channel").length, 1);
  await Promise.all([directory.channel("C2"), directory.channel("C2")]);
  assert.equal(api.calls.filter(call => call[0] === "channel").length, 2);
});

test("one slow channel does not block inbound processing in another", async () => {
  const { api, events, bot } = adapterSetup();
  let release;
  const blocked = new Promise(resolve => { release = resolve; });
  const channelInfo = api.channelInfo;
  api.channelInfo = async id => { if (id === "C1") await blocked; return channelInfo(id); };
  const seen = [];
  bot.hear(/.*/, response => seen.push(response.message.room));
  const first = events.receive("T1", event());
  await events.receive("T1", event({ channel: "C2" }));
  assert.deepEqual(seen, ["C2"]);
  release(); await first;
  assert.deepEqual(seen, ["C2", "C1"]);
});

test("permanent entity lookup failures are dropped while transient failures propagate", async () => {
  for (const [method, code, overrides] of [
    ["channelInfo", "channel_not_found", {}],
    ["userInfo", "user_not_found", { user: "UUNKNOWN" }],
    ["botInfo", "bot_not_found", { user: undefined, bot_id: "BMISSING", subtype: "bot_message" }],
  ]) {
    const { api, events, storage } = adapterSetup();
    api[method] = async () => { throw Object.assign(new Error(code), { data: { error: code } }); };
    await events.receive("T1", event(overrides));
    assert.equal(storage.claims.size, 0);
    api[method] = async () => { throw new Error("network unavailable"); };
    await assert.rejects(events.receive("T1", event({ ...overrides, ts: "next" })), /network unavailable/);
  }
});

test("file_share text reaches listeners and self bot messages remain excluded", async () => {
  const { api, events, bot } = adapterSetup();
  let heard = 0;
  bot.hear(/ping/, () => { heard++; });
  await events.receive("T1", event({ subtype: "file_share" }));
  api.botInfo = async () => ({ id: "BALIAS", user_id: identity.botUserId });
  await events.receive("T1", event({ user: undefined, bot_id: "BALIAS", subtype: "bot_message", ts: "other" }));
  assert.equal(heard, 1);
});

test("long text is chunked without losing Unicode or attachment/thread metadata", async () => {
  const { api, directory } = adapterSetup();
  const transport = new SlackTransport(api, directory);
  const text = "🙂".repeat(9001);
  const attachment = { text: "details" };
  await transport.deliver("send", { room: "C1", message: { thread_ts: "123" } }, [{ text, attachments: [attachment] }]);
  assert.equal(api.posts.length, 3);
  assert.equal(api.posts.map(post => post.text).join(""), text);
  assert(api.posts.every(post => Array.from(post.text).length <= 4000 && post.thread_ts === "123"));
  assert.deepEqual(api.posts[0].attachments, [attachment]);
  assert.equal(api.posts[1].attachments, undefined);
});

test("shared-channel origin is accepted only for the authenticated installation", async t => {
  const service = setup();
  t.after(() => service.stop());
  await service.initialize();
  for (const user of ["UOTHERBOT", identity.botUserId]) {
    await service.app.processEvent({ body: { type: "event_callback", team_id: "TEXTERNAL", event_id: user,
      authorizations: [{ team_id: identity.teamId, user_id: user, is_bot: true }], event: event() }, ack: async () => {} });
    await service.drainEvents();
    assert.equal(service.api.posts.length, user === identity.botUserId ? 1 : 0);
  }
});

test("HTTP helper follows redirects, limits loops and times out hung responses", async t => {
  const { ScriptHttpClient } = require("../scripts/runtime/http-client");
  const server = http.createServer((req, res) => {
    if (req.url === "/redirect") { res.writeHead(302, { location: "/final" }); res.end(); }
    else if (req.url === "/loop") { res.writeHead(302, { location: "/loop" }); res.end(); }
    else if (req.url === "/final") res.end("redirected body");
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const get = path => new Promise(resolve => new ScriptHttpClient(`http://127.0.0.1:${server.address().port}${path}`, undefined, 300).get()(
    (error, response, body) => resolve({ error, response, body })));
  const redirected = await get("/redirect");
  assert.equal(redirected.error, null);
  assert.equal(redirected.body, "redirected body");
  assert.match((await get("/loop")).error.message, /redirect/i);
  assert.match((await get("/hung")).error.message, /timed out/);
});

test("configuration requires HTTP credentials, retains port/name, and needs no app token", () => {
  assert.throws(() => boltConfiguration({}, "test"), /SLACK_BOT_TOKEN/);
  assert.throws(() => boltConfiguration({ SLACK_BOT_TOKEN: "test" }, "test"), /SLACK_SIGNING_SECRET/);
  const env = { SLACK_BOT_TOKEN: "test", SLACK_SIGNING_SECRET: "secret", HUBOT_NAME: "old-name" };
  assert.equal(boltConfiguration(env, "test").port, 8080);
  assert.equal(boltConfiguration(env, "test").name, "old-name");
  for (const port of ["0", "-1", "65536", "abc", "1.5"]) assert.throws(() => boltConfiguration({ ...env, PORT: port }, "test"), /PORT/);
});

test("Redis URL paths remain key prefixes in database zero with legacy env precedence", () => {
  assert.deepEqual(redisConfiguration({}), { url: "redis://localhost:6379/0", storageKey: "hubot:storage" });
  const options = redisConfiguration({ REDIS_URL: "redis://fallback/other", REDISTOGO_URL: "redis://placeholder:password@cache:6379/4" });
  assert.equal(options.storageKey, "4:storage");
  assert.equal(new URL(options.url).pathname, "/0");
  assert.equal(new URL(options.url).username, "");
  assert.equal(new URL(options.url).password, "password");
  assert.equal(redisConfiguration({ REDIS_URL: "rediss://cache/team" }).storageKey, "team:storage");
  assert.equal(redisConfiguration({ REDIS_URL: "redis://cache/team?x=y" }).storageKey, "team?x=y:storage");
  assert.equal(redisConfiguration({ REDIS_URL: "redis://cache/a/../b" }).storageKey, "a/../b:storage");
  assert.throws(() => redisConfiguration({ REDIS_URL: "https://cache" }), /Expected/);
});

test("creating the real Redis wrapper does not connect", async () => {
  const storage = createRedisStorage({}, assert.fail);
  await storage.close();
});

test("Redis writes the original key and claims duplicates atomically with a 24-hour expiry", async () => {
  const commands = [], values = new Map([["hubot:storage", JSON.stringify(savedBrain())]]);
  const client = {
    isOpen: false, isReady: true,
    destroy() { this.isOpen = false; },
    async connect() { this.isOpen = true; },
    async get(key) { commands.push(["get", key]); return values.get(key) ?? null; },
    async set(key, value, options) {
      commands.push(["set", key, value, options]);
      if (options?.NX && values.has(key)) return null;
      values.set(key, value); return "OK";
    },
    async close() { this.isOpen = false; },
  };
  const storage = new RedisStorage(client, "hubot:storage");
  await storage.connect();
  assert.deepEqual(JSON.parse(await storage.read()), savedBrain());
  await storage.write("updated");
  assert.equal(values.get("hubot:storage"), "updated");
  const claims = await Promise.all([storage.claim("T1", "C1", "123"), storage.claim("T1", "C1", "123")]);
  assert.deepEqual(claims, [true, false]);
  assert.equal(await storage.claim("T1", "C2", "123"), true);
  assert.equal(await storage.claim("T2", "C1", "123"), true);
  assert.deepEqual(commands.find(command => command[3]?.NX)[3], { NX: true, EX: 86400 });
  assert.equal(values.get("hubot:storage"), "updated");
  await storage.close(); assert.equal(client.isOpen, false);
});

test("Bolt construction is offline; initialization loads memory before script registration", async t => {
  const order = [];
  const service = setup({ beforeScripts(brain) { order.push("environment"); assert.equal(brain.get("scorefield").alice, 7); }, register(bot) {
    order.push("scripts"); assert.equal(bot.brain.data.extra, "keep");
    bot.brain.on("loaded", () => order.push("loaded"));
  } });
  t.after(() => service.stop());
  assert.equal(service.api.calls.length, 0);
  assert.equal(service.storage.connects, 0);
  await Promise.all([service.initialize(), service.initialize()]);
  assert.equal(service.storage.connects, 1);
  assert.deepEqual(order, ["environment", "scripts", "loaded"]);
});

test("Bolt message and app_mention overlap executes a command only once", async t => {
  const service = setup(); t.after(() => service.stop()); await service.initialize();
  assert.equal(await dispatch(service, event()), true);
  await dispatch(service, event({ type: "app_mention" }));
  await dispatch(service, event());
  assert.deepEqual(service.api.posts.map(post => post.text), ["PONG"]);
  assert.equal(service.storage.claims.size, 1);
  await dispatch(service, event({ ts: "124.456", text: "bot echo hello" }));
  assert.deepEqual(service.api.posts.map(post => post.text), ["PONG", "hello"]);
});

test("persisted dedupe claims survive an app restart", async () => {
  const storage = fakeStorage();
  const first = setup({ storage }); await first.initialize(); await dispatch(first, event()); await first.stop();
  const second = setup({ storage });
  try { await second.initialize(); await dispatch(second, event()); assert.equal(second.api.posts.length, 0); }
  finally { await second.stop(); }
});

test("private channels, DMs, self, Slackbot, edits and deletions do not execute commands", async () => {
  const { bot, events, api, storage } = adapterSetup();
  let calls = 0; bot.hear(/.*/, () => calls++);
  for (const change of [{ channel: "D1" }, { channel: "G1" }, { channel_type: "im" }, { channel_type: "mpim" }, { channel_type: "group" }, { user: "UBOT" }, { bot_id: "BBOT" }, { user: "USLACKBOT" }, { subtype: "message_changed" }, { subtype: "message_deleted" }, { subtype: "channel_join" }, { hidden: true }]) {
    await events.receive("T1", event(change));
  }
  assert.equal(api.calls.length, 0);
  await events.receive("OTHER", event());
  api.channelInfo = async id => ({ id, is_private: true, is_im: false });
  await events.receive("T1", event());
  assert.equal(calls, 0); assert.equal(storage.claims.size, 0);
});

test("missing privacy metadata fails closed, and public-to-private changes bypass cache", async () => {
  const { bot, api, events, storage } = adapterSetup();
  let count = 0; bot.hear(/.*/, () => count++);
  await events.receive("T1", event());
  api.channelInfo = async id => ({ id, is_private: true, is_im: false });
  await events.receive("T1", event({ ts: "124" }));
  assert.equal(count, 1);
  api.channelInfo = async id => ({ id });
  await assert.rejects(events.receive("T1", event({ ts: "125" })), /privacy/);
  assert.equal(storage.claims.size, 1);
});

test("preprocessing failures leave events unclaimed and do not poison later dispatch", async () => {
  const { bot, api, events, storage } = adapterSetup();
  let count = 0; bot.hear(/.*/, () => count++);
  const original = api.channelInfo;
  api.channelInfo = async () => { throw new Error("lookup failed"); };
  await assert.rejects(events.receive("T1", event()), /lookup failed/);
  assert.equal(storage.claims.size, 0);
  api.channelInfo = original;
  await events.receive("T1", event()); assert.equal(count, 1);
});

test("Redis claim errors do not process the message without deduplication", async () => {
  const { bot, events, storage } = adapterSetup();
  bot.hear(/.*/, assert.fail);
  storage.claim = async () => { throw new Error("redis offline"); };
  await assert.rejects(events.receive("T1", event()), /redis offline/);
});

test("other bot messages and thread broadcasts retain supported legacy dispatch", async () => {
  const { brain, bot, events, api } = adapterSetup();
  const users = [];
  bot.hear(/.*/, response => users.push(response.message.user.id));
  await events.receive("T1", event({ subtype: "bot_message", bot_id: "BOTHER", user: undefined }));
  await events.receive("T1", event({ subtype: "thread_broadcast", ts: "124" }));
  api.botInfo = async id => ({ id, name: "legacy-webhook", icons: { image_48: "https://example.invalid/bot.png" } });
  await events.receive("T1", event({ subtype: "bot_message", bot_id: "BWEBHOOK", user: undefined, ts: "125" }));
  assert.deepEqual(users, ["UOTHERBOT", "U1", "bot:BWEBHOOK"]);
  assert.equal(brain.data.users["bot:BWEBHOOK"].name, "legacy-webhook");
  assert.deepEqual(brain.data.users["bot:BWEBHOOK"].slack, {
    id: "BWEBHOOK", name: "legacy-webhook", icons: { image_48: "https://example.invalid/bot.png" },
    bot_id: "BWEBHOOK", is_bot: true,
  });
});

test("normalization retains mentions, channel labels, links, entities and attachments", async () => {
  const { directory, bot, events } = adapterSetup();
  const text = await normalizeSlackText("<@UBOT|new-app> <@U1> <#C1|general> <!here> <https://example.invalid|site> <mailto:a@b.test> &lt;x&gt; &amp;", identity, "bot", directory, logger);
  assert.equal(text, "@bot @alice #general @here site (https://example.invalid) a@b.test <x> &");
  let received;
  bot.hear(/.*/, response => { received = response.message.text; });
  await events.receive("T1", event({ attachments: [{ fallback: "attachment text" }] }));
  assert.equal(received, "@bot ping\nattachment text");
});

test("message snapshots retain their channel while stored users retain roles and counters", async () => {
  const { bot, events, brain } = adapterSetup();
  const snapshots = [];
  bot.hear(/.*/, response => snapshots.push(response.message));
  await events.receive("T1", event());
  await events.receive("T1", event({ channel: "C2", ts: "124" }));
  assert.equal(snapshots[0].user.room, "C1"); assert.equal(snapshots[1].user.room, "C2");
  assert.deepEqual(brain.data.users.U1.roles, ["maintainer"]);
  assert.equal(brain.data.users.U1.msgcount, 3); assert.equal(brain.data.users.U1.custom, true);
});

test("reply, attachments and thread routing preserve payloads and target the resolved channel", async () => {
  const { bot, events, api } = adapterSetup();
  const attachment = { attachments: [{ fallback: "detail", text: "body" }] };
  bot.hear(/.*/, response => { response.reply("hello"); response.send(attachment); });
  await events.receive("T1", event({ thread_ts: "100.001" })); await bot.flush();
  assert.equal(api.posts[0].text, "<@U1>: hello"); assert.equal(api.posts[0].thread_ts, "100.001");
  assert.deepEqual(api.posts[1].attachments, attachment.attachments); assert.equal(api.posts[1].channel, "C1");
  assert.deepEqual(attachment, { attachments: [{ fallback: "detail", text: "body" }] });
  bot.reply({ room: "D1", user: { id: "U1", name: "alice" } }, "direct"); await bot.flush();
  assert.equal(api.posts[2].text, "direct");
});

test("channel names use paginated lookup, IDs need no lookup, and user IDs open DMs", async () => {
  const { directory, api } = adapterSetup();
  api.channels = async cursor => cursor ? { channels: [{ id: "C2", name: "random" }] }
    : { channels: [{ id: "C1", name: "general" }], cursor: "next" };
  assert.equal(await directory.resolve("#random"), "C2");
  api.channels = async () => { throw new Error("must use cache"); };
  assert.equal(await directory.resolve("random"), "C2");
  assert.equal(await directory.resolve("C123"), "C123");
  assert.equal(await directory.resolve("U1"), "D1");
  assert.equal(await directory.resolve("@alice"), "D1");
});

test("Slack API wrapper uses the configured token even when a message contains a token", async () => {
  const calls = [];
  const client = {
    chat: { async postMessage(args) { calls.push(args); } },
    bots: { async info(args) { calls.push(args); return { ok: true, bot: { id: args.bot, name: "webhook" } }; } },
  };
  const api = slackApi(client, "configured-token");
  await api.postMessage({ channel: "C1", text: "hi", token: "injected" });
  assert.equal(calls[0].token, "configured-token");
  assert.deepEqual(await api.botInfo("B1"), { id: "B1", name: "webhook" });
  assert.equal(calls[1].token, "configured-token");
});

test("user_change merges metadata without deleting memory", async t => {
  const service = setup(); t.after(() => service.stop()); await service.initialize();
  await dispatch(service, { type: "user_change", user: { id: "U1", name: "renamed", real_name: "Alice", profile: { email: "new@example.invalid" } } });
  assert.equal(service.brain.data.users.U1.name, "renamed");
  assert.equal(service.brain.data.users.U1.email_address, undefined);
  assert.equal(service.brain.data.users.U1.slack.profile, undefined);
  assert.deepEqual(service.brain.data.users.U1.roles, ["maintainer"]);
});

test("update db uses the authenticated Slack service and keeps the existing summary", async t => {
  const service = setup({ register: bot => require("../scripts/update-names")(bot) });
  service.api.userInfo = async id => ({ id, name: "renamed" });
  t.after(() => service.stop()); await service.initialize();
  await dispatch(service, event({ text: "bot update db" })); await nextTurn(); await service.bot.flush();
  assert.deepEqual(service.api.posts.map(post => post.text), ["Updating names in database", "Updated names for 1 out of 1 users"]);
  assert.deepEqual(service.brain.data.users.U1.roles, ["maintainer"]);
});

test("signed URL verification works; invalid, missing and stale signatures are rejected", async t => {
  const service = setup(); t.after(() => service.stop());
  const server = await service.start({ port: 0, host: "127.0.0.1" });
  const body = { type: "url_verification", challenge: "offline-challenge" };
  const good = await request(server, "/slack/events", body, signature(body));
  assert.equal(good.status, 200); assert.deepEqual(JSON.parse(good.text), { challenge: "offline-challenge" });
  assert.equal((await request(server, "/slack/events", body)).status, 401);
  assert.equal((await request(server, "/slack/events", body, { ...signature(body), "x-slack-signature": "v0=wrong" })).status, 401);
  assert.equal((await request(server, "/slack/events", body, signature(body, 1))).status, 401);
});

test("Slack acknowledges persisted events before slow command processing finishes", async t => {
  let release, entered;
  const started = new Promise(resolve => { entered = resolve; });
  const blocked = new Promise(resolve => { release = resolve; });
  const service = setup({ register(bot) { bot.respond(/slow$/, async () => { entered(); await blocked; }); } });
  t.after(async () => { release(); await service.stop(); });
  const server = await service.start({ port: 0, host: "127.0.0.1" });
  const body = { type: "event_callback", team_id: "T1", event_id: "EvSlow", event: event({ text: "bot slow" }) };
  let responded = false;
  const responsePromise = request(server, "/slack/events", body, signature(body)).then(response => {
    responded = true;
    return response;
  });
  await started;
  await nextTurn();
  assert.equal((await responsePromise).status, 200);
  assert.equal(responded, true);
  assert.equal(service.storage.inbox.size, 1);
  release();
  assert.equal((await responsePromise).status, 200);
});

test("transient preprocessing failure remains in the inbox and succeeds after restart", async t => {
  const api = fakeApi();
  const original = api.channelInfo;
  let fail = true;
  api.channelInfo = async id => {
    if (fail) { fail = false; throw new Error("temporary Slack lookup failure"); }
    return original(id);
  };
  const service = setup({ api });
  t.after(() => service.stop());
  const server = await service.start({ port: 0, host: "127.0.0.1" });
  const body = { type: "event_callback", team_id: "T1", event_id: "EvLookupRetry", event: event() };
  assert.equal((await request(server, "/slack/events", body, signature(body))).status, 200);
  await service.drainEvents();
  assert.equal(service.storage.claims.size, 0);
  assert.equal(service.storage.inbox.size, 1);
  await service.stop();
  const restarted = setup({ storage: service.storage, api });
  t.after(() => restarted.stop());
  await restarted.initialize();
  await restarted.drainEvents();
  await restarted.bot.flush();
  assert.equal(service.storage.inbox.size, 0);
  assert.deepEqual(api.posts.map(post => post.text), ["PONG"]);
});

test("a burst of HTTP events is acknowledged while channel workers are blocked", { timeout: 5000 }, async t => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const service = setup({ register(bot) { bot.respond(/ping$/, async () => { await gate; }); } });
  t.after(async () => { release(); await service.stop(); });
  const server = await service.start({ port: 0, host: "127.0.0.1" });
  const responses = await Promise.all(Array.from({ length: 30 }, (_, i) => {
    const body = { type: "event_callback", team_id: "T1", event_id: `Burst${i}`,
      event: event({ ts: String(i), channel: `C${i % 3}`, channel_type: "channel" }) };
    return request(server, "/slack/events", body, signature(body));
  }));
  assert(responses.every(response => response.status === 200));
  assert.equal(service.storage.inbox.size, 30);
  release(); await service.drainEvents();
  assert.equal(service.storage.inbox.size, 0);
  assert.equal(service.api.calls.filter(call => call[0] === "channel").length, 3);
});

test("an unresponsive Redis enqueue returns non-2xx before Slack's acknowledgement deadline", { timeout: 5000 }, async t => {
  const storage = fakeStorage();
  storage.enqueue = () => new Promise(() => {});
  const service = setup({ storage });
  t.after(() => service.stop());
  const server = await service.start({ port: 0, host: "127.0.0.1" });
  const body = { type: "event_callback", team_id: "T1", event_id: "HungRedis", event: event() };
  const start = performance.now();
  const response = await request(server, "/slack/events", body, signature(body));
  assert.equal(response.status, 500);
  assert(performance.now() - start < 3000);
  assert.equal(storage.claims.size, 0);
});

test("transient Redis inbox failures return 500 and the Slack retry succeeds", async t => {
  const storage = fakeStorage();
  const enqueue = storage.enqueue.bind(storage);
  let fail = true;
  storage.enqueue = async (...key) => {
    if (fail) { fail = false; throw new Error("temporary Redis claim failure"); }
    return enqueue(...key);
  };
  const service = setup({ storage });
  t.after(() => service.stop());
  const server = await service.start({ port: 0, host: "127.0.0.1" });
  const body = { type: "event_callback", team_id: "T1", event_id: "EvClaimRetry", event: event() };
  assert.equal((await request(server, "/slack/events", body, signature(body))).status, 500);
  assert.equal(storage.claims.size, 0);
  assert.equal((await request(server, "/slack/events", body, signature(body))).status, 200);
});

test("existing HTTP routes and authenticated JSON webhook run on the Bolt receiver", async t => {
  const previous = process.env.HUBOT_ENV_AUTH_TOKEN; process.env.HUBOT_ENV_AUTH_TOKEN = "offline-webhook";
  t.after(() => { if (previous === undefined) delete process.env.HUBOT_ENV_AUTH_TOKEN; else process.env.HUBOT_ENV_AUTH_TOKEN = previous; });
  const service = setup({ register(bot) {
    require("../scripts/httpd")(bot);
    bot.router.post("/form", (req, res) => res.end(JSON.stringify(req.body)));
  } });
  t.after(() => service.stop()); const server = await service.start({ port: 0, host: "127.0.0.1" });
  assert.equal((await request(server, "/hubot/ping", {})).text, "PONG");
  assert.equal((await request(server, "/hubot/version", "", {}, "GET")).text, "test");
  const payload = { queryResult: { parameters: { name: "", any: "hello" } } };
  assert.equal((await request(server, "/hubot/slack", payload)).status, 401);
  assert.equal(service.api.posts.length, 0);
  const response = await request(server, "/hubot/slack", payload, { authorization: "offline-webhook" });
  assert.equal(response.status, 200); assert.equal(JSON.parse(response.text).fulfillmentText, "Announcement sent");
  await service.bot.flush(); assert.equal(service.api.posts[0].text, "Announcement : 'hello'");
  const form = await request(server, "/form", "name=alice&nested[value]=yes", { "content-type": "application/x-www-form-urlencoded" });
  assert.deepEqual(JSON.parse(form.text), { name: "alice", nested: { value: "yes" } });
});

test("corrupt memory prevents Slack initialization and never gets overwritten", async () => {
  const service = setup({ storage: fakeStorage("{invalid") });
  await assert.rejects(service.initialize()); await service.stop();
  assert.equal(service.api.calls.length, 0); assert.equal(service.storage.writes.length, 0);
  assert.equal(service.storage.closes, 1);
});

test("startup failure after loading memory still does not overwrite stored data", async () => {
  const service = setup({ register() { throw new Error("script failed"); } });
  await assert.rejects(service.initialize(), /script failed/); await service.stop();
  assert.equal(service.storage.writes.length, 0); assert.equal(service.storage.closes, 1);
});

test("shutdown drains pending handlers and sends before the final brain save", async () => {
  let release, entered;
  const started = new Promise(resolve => { entered = resolve; });
  const blocked = new Promise(resolve => { release = resolve; });
  const service = setup({ register(bot) { bot.respond(/slow$/, async response => {
    entered(); await blocked; bot.brain.set("finished", true); response.send("done");
  }); } });
  await service.initialize();
  const processing = dispatch(service, event({ text: "bot slow" }));
  await started;
  const stopping = service.stop();
  assert.strictEqual(service.stop(), stopping);
  await nextTurn(); assert.equal(service.storage.writes.length, 0);
  release(); await processing; await stopping;
  assert.equal(JSON.parse(service.storage.value)._private.finished, true);
  assert.equal(service.api.posts[0].text, "done");
  assert.equal(service.storage.closes, 1);
});

test("startup refreshes paginated users without deleting old users or their script data", async t => {
  const api = fakeApi(), cursors = [];
  api.users = async cursor => {
    cursors.push(cursor);
    return cursor ? { users: [{ id: "U2", name: "bob" }] }
      : { users: [{ id: "U1", name: "renamed", real_name: "Alice" }], cursor: "next" };
  };
  const service = setup({ api }); t.after(() => service.stop()); await service.initialize();
  assert.deepEqual(cursors, [undefined, "next"]);
  assert.equal(service.brain.data.users.U1.name, "renamed");
  assert.deepEqual(service.brain.data.users.U1.roles, ["maintainer"]);
  assert.deepEqual(service.brain.data.users.U1.words, { hello: 2 });
  assert.equal(service.brain.userForName("bob").id, "U2");
  assert.equal(service.brain.data.extra, "keep");
});

test("Redis unavailability returns HTTP 503 before acknowledging, then accepts a retry", async t => {
  const service = setup(); t.after(() => service.stop());
  const server = await service.start({ port: 0, host: "127.0.0.1" });
  const body = { type: "event_callback", team_id: "T1", event_id: "EvRetry", event: event() };
  service.storage.ready = false;
  assert.equal((await request(server, "/slack/events", body, signature(body))).status, 503);
  assert.equal(service.storage.claims.size, 0);
  service.storage.ready = true;
  assert.equal((await request(server, "/slack/events", body, signature(body))).status, 200);
  await service.drainEvents();
  assert.deepEqual(service.api.posts.map(post => post.text), ["PONG"]);
});

test("unauthorized workspaces cannot update users or run commands", async t => {
  const service = setup(); t.after(() => service.stop()); await service.initialize();
  t.mock.method(service.app.logger, "error", () => {});
  await dispatch(service, event(), "OTHER");
  await dispatch(service, { type: "user_change", user: { id: "U1", name: "wrong" } }, "OTHER");
  assert.equal(service.api.posts.length, 0);
  assert.equal(service.brain.data.users.U1.name, "alice");
});

test("Slack initialization failure closes Redis without saving startup mutations", async () => {
  const api = fakeApi(); api.identity = async () => { throw new Error("invalid token"); };
  const service = setup({ api });
  await assert.rejects(service.initialize(), /invalid token/); await service.stop();
  assert.equal(service.storage.writes.length, 0); assert.equal(service.storage.closes, 1);
});

test("a stopped app cannot restart or create a second listener", async t => {
  const service = setup(); t.after(() => service.stop());
  await service.start({ port: 0, host: "127.0.0.1" });
  await assert.rejects(service.start({ port: 0, host: "127.0.0.1" }), /already started/);
  await service.stop();
  await assert.rejects(service.start({ port: 0, host: "127.0.0.1" }), /stopping/);
  assert.equal(service.storage.connects, 1);
});

test("stopping while the receiver binds closes the new server and saves once", async () => {
  const service = setup(); await service.initialize();
  const original = service.receiver.start.bind(service.receiver);
  let entered, release;
  const binding = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  service.receiver.start = async (...args) => { entered(); await gate; return original(...args); };
  const starting = service.start({ port: 0, host: "127.0.0.1" });
  await binding; const stopping = service.stop(); release();
  const server = await starting; await stopping;
  assert.equal(server.listening, false);
  assert.equal(service.storage.writes.length, 1);
});

test("startup cannot hang indefinitely waiting for Redis", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let destroyed = false;
  const client = { isOpen: true, isReady: false, connect: () => new Promise(() => {}), destroy() { destroyed = true; } };
  const storage = new RedisStorage(client, "hubot:storage");
  const connecting = storage.connect();
  const rejected = assert.rejects(connecting, /timed out/);
  t.mock.timers.tick(30000); await rejected;
  assert.equal(destroyed, true);
});

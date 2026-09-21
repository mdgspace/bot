"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { EventEmitter } = require("node:events");
const { readFileSync } = require("node:fs");
const { setImmediate: nextTurn } = require("node:timers/promises");
const { Brain, BrainPersistence } = require("../scripts/runtime/brain");
const { Bot, TextMessage } = require("../scripts/runtime/bot");
const { ScriptHttpClient } = require("../scripts/runtime/http-client");

// All transports and persistence in this suite are fakes. No credentials or
// Slack/Redis clients are instantiated, and HTTP tests inject request doubles.
function fixture() {
  return {
    users: { U1: { id: "U1", name: "alice", room: "general", roles: ["maintainer"], msgcount: 4, words: { hello: 2 }, custom: "keep" } },
    _private: { scorefield: { alice: 7 }, detailedfield: { alice: { plus: { bob: 2 } } }, skippedlist: ["test"], "hubot-env": { env: { TEST_FLAG: "yes" } } },
    seen: { alice: { chan: "general", date: 12345 } },
    unknownScript: { nested: [1, "two", null] },
  };
}

function storageFor(saved = JSON.stringify(fixture())) {
  return {
    saved, writes: [], closes: 0,
    async read() { return this.saved; },
    async write(value) { this.writes.push(value); this.saved = value; },
    async close() { this.closes++; },
  };
}

function botFor(overrides = {}) {
  const sent = [], errors = [], routes = [];
  const brain = new Brain();
  brain.restore(JSON.stringify(fixture()));
  const bot = new Bot({
    name: "bot", version: "test", brain,
    logger: { debug() {}, info() {}, warning() {}, error(error) { errors.push(error); } },
    router: Object.fromEntries(["get", "post", "put", "delete"].map(method =>
      [method, (path, callback) => routes.push({ method, path, callback })])),
    transport: { async deliver(method, envelope, messages) { sent.push({ method, envelope, messages }); } },
    ...overrides,
  });
  return { bot, brain: bot.brain, sent, errors, routes };
}

function message(text, room = "C1") {
  return new TextMessage({ id: "U1", name: "alice", room: "general" }, text, room);
}

test("legacy brain JSON round-trips without losing private, user, seen or unknown fields", async () => {
  const brain = new Brain(), storage = storageFor();
  const persistence = new BrainPersistence(brain, storage, assert.fail);
  let loaded = 0;
  brain.on("loaded", () => loaded++);
  await persistence.load();
  assert.equal(loaded, 1);
  assert.deepEqual(brain.data, fixture());
  assert.equal(brain.get("scorefield").alice, 7);
  await persistence.save();
  assert.deepEqual(JSON.parse(storage.saved), fixture());
  await persistence.close();
});

test("missing storage initializes namespaces and emits loaded", () => {
  const brain = new Brain();
  let loaded;
  brain.on("loaded", data => { loaded = data; });
  brain.restore(null);
  assert.strictEqual(loaded, brain.data);
  assert.deepEqual(brain.data, { users: {}, _private: {} });
  assert.equal(brain.get("missing"), null);
});

test("malformed snapshots leave live memory untouched", () => {
  const brain = new Brain();
  brain.restore(JSON.stringify(fixture()));
  const previous = brain.data;
  for (const invalid of ["{", "null", "[]", "false", '{"users":[]}', '{"_private":null}', '{"users":{"U1":null}}']) {
    assert.throws(() => brain.restore(invalid));
    assert.strictEqual(brain.data, previous);
  }
});

test("failed reads or corrupt JSON never overwrite stored memory, including at shutdown", async () => {
  for (const read of [async () => { throw new Error("unavailable"); }, async () => "{invalid"]) {
    const storage = storageFor();
    storage.read = read;
    const persistence = new BrainPersistence(new Brain(), storage, assert.fail);
    await assert.rejects(persistence.load());
    await assert.rejects(persistence.save(), /not ready/);
    assert.throws(() => persistence.start(), /Load brain/);
    await persistence.close();
    assert.deepEqual(storage.writes, []);
    assert.equal(storage.closes, 1);
  }
});

test("private keys retain null semantics and loaded notification without prototype collisions", () => {
  const brain = new Brain();
  let loaded = 0;
  brain.on("loaded", () => loaded++);
  brain.set("score", 0);
  brain.set("enabled", false);
  brain.set("__proto__", { safe: true });
  assert.equal(brain.get("score"), 0);
  assert.equal(brain.get("enabled"), false);
  assert.equal(brain.get("toString"), null);
  assert.deepEqual(brain.get("__proto__"), { safe: true });
  assert.equal(Object.getPrototypeOf(brain.data._private), Object.prototype);
  assert.equal(loaded, 3);
  brain.remove("score");
  assert.equal(brain.get("score"), null);
});

test("user metadata refresh keeps object identity, roles, counters and unknown properties", () => {
  const brain = new Brain();
  brain.restore(JSON.stringify(fixture()));
  const original = brain.data.users.U1;
  const user = brain.userForId("U1", { id: "wrong", name: "new-name", room: "C2", roles: undefined });
  assert.strictEqual(user, original);
  assert.equal(user.id, "U1");
  assert.equal(user.name, "new-name");
  assert.equal(user.room, "C2");
  assert.deepEqual(user.roles, ["maintainer"]);
  assert.equal(user.msgcount, 4);
  assert.deepEqual(user.words, { hello: 2 });
  assert.equal(user.custom, "keep");
  assert.deepEqual(brain.userForId("U2"), { id: "U2", name: "U2" });
});

test("username lookups preserve case-insensitive prefix and exact-match preference", () => {
  const brain = new Brain();
  const alice = brain.userForId("U1", { name: "Alice" });
  const alicia = brain.userForId("U2", { name: "Alicia" });
  brain.userForId("U3", { name: "Malice" });
  assert.strictEqual(brain.userForName("ALICE"), alice);
  assert.equal(brain.userForName("Ali"), null);
  assert.deepEqual(brain.usersForFuzzyName("ALICE"), [alice]);
  assert.deepEqual(brain.usersForRawFuzzyName("aLi"), [alice, alicia]);
  assert.deepEqual(brain.usersForFuzzyName("missing"), []);
});

test("saves include in-place mutations and serialize overlapping writes", async () => {
  const brain = new Brain(), storage = storageFor();
  const releases = [];
  storage.write = value => new Promise(resolve => {
    storage.writes.push(value);
    releases.push(resolve);
  });
  const persistence = new BrainPersistence(brain, storage, assert.fail);
  await persistence.load();
  brain.get("scorefield").alice++;
  const first = persistence.save();
  brain.data.users.U1.roles.push("guitarist");
  const second = persistence.save();
  await nextTurn();
  assert.equal(storage.writes.length, 1);
  assert.equal(JSON.parse(storage.writes[0])._private.scorefield.alice, 8);
  assert.deepEqual(JSON.parse(storage.writes[0]).users.U1.roles, ["maintainer"]);
  releases.shift()();
  await first;
  await nextTurn();
  assert.equal(storage.writes.length, 2);
  assert.deepEqual(JSON.parse(storage.writes[1]).users.U1.roles, ["maintainer", "guitarist"]);
  releases.shift()();
  await second;
});

test("failed writes are observable and do not prevent later saves", async () => {
  const storage = storageFor();
  let attempts = 0;
  storage.write = async value => {
    if (++attempts === 1) throw new Error("write failed");
    storage.writes.push(value);
  };
  const persistence = new BrainPersistence(new Brain(), storage, assert.fail);
  await persistence.load();
  await assert.rejects(persistence.save(), /write failed/);
  await persistence.save();
  assert.equal(storage.writes.length, 1);
  await persistence.close();
});

test("close flushes the latest memory exactly once and rejects subsequent saves", async () => {
  const brain = new Brain(), storage = storageFor();
  const persistence = new BrainPersistence(brain, storage, assert.fail);
  await persistence.load();
  brain.data.seen.alice.date = 999;
  const close = persistence.close();
  assert.strictEqual(persistence.close(), close);
  await close;
  assert.equal(storage.writes.length, 1);
  assert.equal(JSON.parse(storage.saved).seen.alice.date, 999);
  assert.equal(storage.closes, 1);
  await assert.rejects(persistence.save());
});

test("shutdown still closes storage when its final save fails", async () => {
  const storage = storageFor();
  storage.write = async () => { throw new Error("offline"); };
  const persistence = new BrainPersistence(new Brain(), storage, assert.fail);
  await persistence.load();
  await assert.rejects(persistence.close(), /offline/);
  assert.equal(storage.closes, 1);
});

test("autosave reports failures and stops when closed", async t => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const storage = storageFor(), errors = [];
  const persistence = new BrainPersistence(new Brain(), storage, error => errors.push(error));
  await persistence.load();
  persistence.start(100);
  t.mock.timers.tick(100);
  await nextTurn();
  assert.equal(storage.writes.length, 1);
  const write = storage.write;
  storage.write = async () => { throw new Error("offline"); };
  t.mock.timers.tick(100);
  await nextTurn();
  assert.equal(errors.length, 1);
  storage.write = write;
  await persistence.close();
  t.mock.timers.tick(1000);
  await nextTurn();
  assert.equal(storage.writes.length, 2);
});

test("respond accepts legacy names, punctuation and aliases without shifting captures", async () => {
  const { bot } = botFor({ name: "b.ot", alias: "b.ot-long" });
  const captures = [];
  bot.respond(/echo (.+)$/i, response => captures.push(response.match[1]));
  for (const text of ["b.ot echo one", "@b.ot: echo two", " B.OT, echo three", "b.ot-long echo four", "echo ignored", "bxot echo ignored", "someone b.ot echo ignored"]) {
    await bot.receive(message(text));
  }
  assert.deepEqual(captures, ["one", "two", "three", "four"]);
});

test("hear preserves global match arrays and resets state between messages", async () => {
  const { bot } = botFor();
  const matches = [];
  bot.hear(/[a-z]+(\+\+|--)/gi, response => matches.push([...response.match]));
  await bot.receive(message("alice++ bob--"));
  await bot.receive(message("alice++ bob--"));
  assert.deepEqual(matches, [["alice++", "bob--"], ["alice++", "bob--"]]);
});

test("receive middleware runs before matching and can stop all listeners", async () => {
  const { bot } = botFor();
  let calls = 0;
  bot.hear(/.*/, () => calls++);
  bot.receiveMiddleware(({ response }, next, done) => {
    if (response.message.text === "blocked") { response.message.finish(); done(); }
    else { response.message.text = "rewritten"; next(done); }
  });
  bot.hear(/^rewritten$/, () => calls++);
  await bot.receive(message("blocked"));
  assert.equal(calls, 0);
  await bot.receive(message("allowed"));
  assert.equal(calls, 2);
});

test("listener middleware stops individual listeners and finish stops later matches", async () => {
  const { bot } = botFor();
  const calls = [];
  bot.listenerMiddleware(({ response }, next, done) => {
    if (response.match[0] === "skip") done(); else next(done);
  });
  bot.hear(/skip/, () => calls.push("skipped"));
  bot.hear(/stop/, response => { calls.push("stop"); response.message.finish(); });
  bot.hear(/.*/, () => calls.push("last"));
  await bot.receive(message("skip stop"));
  assert.deepEqual(calls, ["stop"]);
});

test("async middleware and handlers retain registration order; handler failures are logged", async () => {
  const { bot, errors } = botFor();
  const order = [];
  bot.receiveMiddleware((context, next, done) => { setImmediate(() => { order.push("middleware"); next(done); }); });
  bot.hear(/.*/, async () => { await nextTurn(); order.push("first"); throw new Error("handler failed"); });
  bot.hear(/.*/, () => order.push("second"));
  await bot.receive(message("hello"));
  assert.deepEqual(order, ["middleware", "first", "second"]);
  assert.equal(errors[0].message, "handler failed");
});

test("send/reply/emote preserve order, envelopes, attachments and thread context", async () => {
  const { bot, sent } = botFor();
  const incoming = message("hello");
  incoming.thread_ts = "123.456";
  const attachment = { attachments: [{ text: "detail" }] };
  bot.hear(/hello/, response => {
    response.send("one", attachment);
    response.reply("two");
    response.emote("three");
  });
  await bot.receive(incoming);
  bot.send("general", "four");
  bot.send(incoming.user, "five");
  await bot.flush();
  assert.deepEqual(sent.map(item => item.method), ["send", "reply", "emote", "send", "send"]);
  assert.deepEqual(sent[0].messages, ["one", attachment]);
  assert.strictEqual(sent[0].envelope.message, incoming);
  assert.equal(sent[0].envelope.message.thread_ts, "123.456");
  assert.deepEqual(sent[3].envelope, { room: "general" });
  assert.strictEqual(sent[4].envelope.user, incoming.user);
});

test("rejected unawaited sends are logged and later sends still run", async () => {
  const calls = [];
  const { bot, errors } = botFor({ transport: { async deliver(method, envelope, messages) {
    calls.push(messages[0]);
    if (messages[0] === "fail") throw new Error("delivery failed");
  } } });
  bot.send("C1", "fail");
  bot.send("C1", "next");
  await bot.flush();
  assert.deepEqual(calls, ["fail", "next"]);
  assert.equal(errors[0].message, "delivery failed");
});

test("existing internal events still carry script payloads", () => {
  const { bot } = botFor();
  const payload = { username: "alice" };
  let received;
  bot.on("plusplus", event => { received = event; });
  bot.emit("plusplus", payload);
  assert.strictEqual(received, payload);
});

test("help reads command comments, skips None placeholders and returns a copy", () => {
  const { bot } = botFor();
  bot.addHelp(readFileSync(require.resolve("../scripts/help"), "utf8"));
  bot.addHelp('// Commands:\n//   hubot aaa - first\n// Notes:\n//   not a command');
  bot.addHelp(readFileSync(require.resolve("../scripts/idlecheck"), "utf8"));
  bot.addHelp(readFileSync(require.resolve("../scripts/httpd"), "utf8"));
  bot.addHelp('// Commands:\n//   nOnE');
  const commands = bot.helpCommands();
  assert.equal(commands.length, 3);
  assert.equal(commands[0], "hubot aaa - first");
  assert(commands.every(command => command.startsWith("hubot ")));
  assert.equal(commands.some(command => /^none$/i.test(command)), false);
  commands.length = 0;
  assert.equal(bot.helpCommands().length, 3);
});

test("existing ping and echo scripts execute through the local dispatcher unchanged", async () => {
  const { bot, sent } = botFor();
  require("../scripts/ping")(bot);
  for (const text of ["bot ping", "@bot echo hello", "bot adapter", "ping"]) await bot.receive(message(text));
  await bot.flush();
  assert.deepEqual(sent.map(item => item.messages), [["PONG"], ["hello"], ["slack"]]);
});

test("existing privacy middleware blocks Slackbot, private-channel and DM messages", async () => {
  const { bot } = botFor();
  require("../scripts/middleware")(bot);
  let calls = 0;
  bot.hear(/.*/, () => calls++);
  const slackbot = message("hello");
  slackbot.user.id = "USLACKBOT";
  const privateMessage = message("hello");
  privateMessage.rawMessage = { channel: { is_private: true } };
  const dm = message("hello", "D1");
  dm.rawMessage = { channel: { is_im: true } };
  for (const incoming of [slackbot, privateMessage, dm]) await bot.receive(incoming);
  assert.equal(calls, 0);
  await bot.receive(message("public"));
  assert.equal(calls, 1);
});

test("seen retains restored history across loaded events and ignores PM users", async () => {
  const { bot, brain } = botFor();
  require("../scripts/seen")(bot);
  brain.restore(JSON.stringify(fixture()));
  const incoming = message("hello");
  incoming.user = { id: "U2", name: "Bob", room: "random" };
  await bot.receive(incoming);
  brain.set("another-key", true);
  assert.deepEqual(brain.data.seen.alice, fixture().seen.alice);
  assert.equal(brain.data.seen.bob.chan, "random");
  incoming.user = { id: "U3", name: "Private", pm: true };
  await bot.receive(incoming);
  assert.equal(brain.data.seen.private, undefined);
});

test("leaderboard global matches keep positive minus occurrence counts", async t => {
  const util = require("../scripts/util");
  t.mock.method(util, "info", callback => callback(null, "Bob,x,x,x,1,x,x,x,x,x,bob,x,x"));
  const { bot, brain } = botFor();
  require("../scripts/leaderboard")(bot);
  await bot.receive(message("bob--"));
  assert.equal(brain.get("detailedfield").bob.minus.alice, 1);
  assert.equal(brain.get("scorefield").bob, -1);
  await bot.flush();
});

function fakeHttp(respond) {
  const calls = [];
  return {
    calls,
    request(url, options, callback) {
      const req = new EventEmitter();
      req.end = body => {
        calls.push({ url: url.toString(), options, body });
        queueMicrotask(() => {
          const res = new EventEmitter();
          res.statusCode = 200;
          res.headers = { "content-type": "text/plain" };
          res.setEncoding = encoding => assert.equal(encoding, "utf8");
          callback(res);
          respond(req, res);
        });
      };
      return req;
    },
  };
}

test("HTTP helper stays lazy and preserves merged query parameters and headers", async () => {
  const fake = fakeHttp((req, res) => { res.emit("data", "hel"); res.emit("data", "lo"); res.emit("end"); });
  const client = new ScriptHttpClient("https://example.invalid/path?keep=1&q=old", fake.request);
  const get = client.header("X-Test", "yes").query({ q: "new value", count: 2 }).get();
  assert.equal(fake.calls.length, 0);
  await new Promise((resolve, reject) => get((error, res, body) => {
    try { assert.equal(error, null); assert.equal(res.statusCode, 200); assert.equal(body, "hello"); resolve(); }
    catch (failure) { reject(failure); }
  }));
  assert.equal(fake.calls[0].url, "https://example.invalid/path?keep=1&q=new%20value&count=2");
  assert.equal(fake.calls[0].options.method, "GET");
  assert.equal(fake.calls[0].options.headers["x-test"], "yes");
});

test("HTTP post passes UTF-8 byte lengths and surfaces non-200 responses unchanged", async () => {
  const fake = fakeHttp((req, res) => { res.statusCode = 302; res.emit("data", "redirect"); res.emit("end"); });
  await new Promise((resolve, reject) => new ScriptHttpClient("http://example.invalid", fake.request).post("é")((error, res, body) => {
    try { assert.equal(error, null); assert.equal(res.statusCode, 302); assert.equal(body, "redirect"); resolve(); }
    catch (failure) { reject(failure); }
  }));
  assert.equal(fake.calls.length, 1);
  assert.equal(fake.calls[0].options.method, "POST");
  assert.equal(fake.calls[0].options.headers["content-length"], "2");
  assert.equal(fake.calls[0].body, "é");
});

test("HTTP failures call back once with null response/body, even after abort and end", async () => {
  let callbacks = 0;
  const fake = fakeHttp((req, res) => {
    res.emit("aborted"); req.emit("error", new Error("socket closed")); res.emit("end");
  });
  new ScriptHttpClient("https://example.invalid", fake.request).get()((error, res, body) => {
    callbacks++;
    assert.match(error.message, /aborted/);
    assert.equal(res, null);
    assert.equal(body, null);
  });
  await nextTurn();
  assert.equal(callbacks, 1);
  assert.throws(() => new ScriptHttpClient("file:///no-network"), /Unsupported/);
});

test("synchronous HTTP setup errors use the callback contract", () => {
  let calls = 0;
  new ScriptHttpClient("https://example.invalid", () => { throw new Error("setup failed"); }).get()((error, res, body) => {
    calls++;
    assert.equal(error.message, "setup failed");
    assert.equal(res, null);
    assert.equal(body, null);
  });
  assert.equal(calls, 1);
});

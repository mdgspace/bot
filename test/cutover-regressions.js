"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const cron = require("node-cron");
const { Brain } = require("../scripts/runtime/brain");
const { Bot, TextMessage } = require("../scripts/runtime/bot");
const { SCRIPT_NAMES, loadScripts } = require("../scripts/runtime/script-loader");
const { registerEnvironmentCommands, restorePersistedEnvironment } = require("../scripts/environment");
const { boltConfiguration } = require("../scripts/runtime/bolt-app");

const logger = { debug() {}, error() {}, info() {}, warning() {} };

function botFixture(brain = new Brain()) {
  const sent = [];
  const bot = new Bot({
    name: "bot",
    version: "test",
    brain,
    logger,
    router: Object.fromEntries(["get", "post", "put", "delete"].map(method => [method, () => {}])),
    transport: { async deliver(method, envelope, messages) { sent.push({ method, envelope, messages }); } },
    slack: { async userInfo(id) { return { id, name: id }; } },
  });
  return { bot, sent };
}

async function command(bot, text) {
  await bot.receive(new TextMessage({ id: "U1", name: "alice", room: "C1" }, text, "C1"));
  await bot.flush();
}

function preserveEnvironment(t, keys) {
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

test("script manifest covers every command module exactly once in alphabetical order", () => {
  const sourceDirectory = path.resolve(__dirname, "..", "src-ts");
  const sourceScripts = fs.readdirSync(sourceDirectory)
    .filter(file => file.endsWith(".ts"))
    .map(file => path.basename(file, ".ts"))
    .filter(name => !["environment", "main", "util"].includes(name))
    .sort();
  assert.deepEqual([...SCRIPT_NAMES], sourceScripts);
  assert.deepEqual([...new Set(SCRIPT_NAMES)], [...SCRIPT_NAMES]);
  assert.deepEqual([...SCRIPT_NAMES].sort(), [...SCRIPT_NAMES]);
});

test("loader registers scripts and help in manifest order", () => {
  const actions = [];
  const fakeBot = { addHelp(source) { actions.push(`help:${source}`); } };
  loadScripts(fakeBot, {
    scriptsDirectory: path.sep,
    read(file) { return path.basename(file, ".js"); },
    load(file) {
      const name = path.basename(file, ".js");
      return bot => { assert.strictEqual(bot, fakeBot); actions.push(`load:${name}`); };
    },
  });
  assert.deepEqual(actions, SCRIPT_NAMES.flatMap(name => [`help:${name}`, `load:${name}`]));
});

test("loader fails startup if a command module has an invalid export", () => {
  const badName = SCRIPT_NAMES[4];
  assert.throws(() => loadScripts({ addHelp() {} }, {
    scriptsDirectory: path.sep,
    read() { return ""; },
    load(file) { return path.basename(file, ".js") === badName ? {} : () => {}; },
  }), new RegExp(`Script ${badName}`));
});

test("all production scripts register offline and retain help commands", async t => {
  t.mock.method(cron, "schedule", () => ({ start() {}, stop() {} }));
  const brain = new Brain();
  brain.restore(JSON.stringify({ users: { U1: { id: "U1", name: "alice" } }, _private: {} }));
  const { bot, sent } = botFixture(brain);
  loadScripts(bot);
  assert(bot.helpCommands().length >= 30);
  await command(bot, "bot ping");
  assert(sent.some(item => item.messages[0] === "PONG"));
  await command(bot, "ship it");
  assert(sent.some(item => /^https?:\/\//.test(item.messages[0])));
});

test("persisted environment is restored without logging secret values", t => {
  preserveEnvironment(t, ["CUTOVER_BOOT_VALUE", "SLACK_BOT_TOKEN"]);
  const brain = new Brain();
  brain.restore(JSON.stringify({ users: {}, _private: { "hubot-env": { env: {
    CUTOVER_BOOT_VALUE: "loaded-before-scripts",
    SLACK_BOT_TOKEN: "never-log-this",
    INVALID_VALUE: 12,
  } } } }));
  const logs = [];
  const count = restorePersistedEnvironment(brain, {
    debug() {}, error() {}, info(...args) { logs.push(args.join(" ")); }, warning(...args) { logs.push(args.join(" ")); },
  });
  assert.equal(count, 2);
  assert.equal(process.env.CUTOVER_BOOT_VALUE, "loaded-before-scripts");
  assert.equal(process.env.SLACK_BOT_TOKEN, "never-log-this");
  assert.equal(logs.join(" ").includes("never-log-this"), false);
  assert(logs.some(line => line.includes("INVALID_VALUE")));
});

test("environment current always redacts credential-like variables", async t => {
  preserveEnvironment(t, ["BOT_ADMIN_IDS"]); process.env.BOT_ADMIN_IDS = "U1";
  const keys = ["CUTOVER_VISIBLE", "CUTOVER_PASSWORD", "SLACK_BOT_TOKEN", "HUBOT_ENV_HIDDEN_WORDS"];
  preserveEnvironment(t, keys);
  process.env.CUTOVER_VISIBLE = "shown";
  process.env.CUTOVER_PASSWORD = "hidden-password";
  process.env.SLACK_BOT_TOKEN = "hidden-slack-token";
  process.env.HUBOT_ENV_HIDDEN_WORDS = "VISIBLE";
  const brain = new Brain(); brain.restore(null);
  const { bot, sent } = botFixture(brain);
  registerEnvironmentCommands(bot);
  await command(bot, "bot env current --prefix=CUTOVER_");
  const output = sent.at(-1).messages[0];
  assert.match(output, /CUTOVER_VISIBLE=\*\*\*/);
  assert.match(output, /CUTOVER_PASSWORD=\*\*\*/);
  assert.equal(output.includes("shown"), false);
  assert.equal(output.includes("hidden-password"), false);
  await command(bot, "bot env current --prefix=SLACK_BOT_");
  assert.equal(sent.at(-1).messages[0], "SLACK_BOT_TOKEN=***");
});

test("environment file load and flush retain the existing brain format", async t => {
  preserveEnvironment(t, ["BOT_ADMIN_IDS"]); process.env.BOT_ADMIN_IDS = "U1";
  const keys = ["HUBOT_ENV_BASE_PATH", "CUTOVER_VALUE", "CUTOVER_UNCHANGED", "SLACK_SIGNING_SECRET"];
  preserveEnvironment(t, keys);
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "bot-env-"));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  fs.writeFileSync(path.join(temporary, "account.env"), [
    "CUTOVER_VALUE='new-value'",
    "CUTOVER_UNCHANGED=same",
    "SLACK_SIGNING_SECRET=never-display",
    "# COMMENTED=value",
    "INVALID_LINE",
  ].join("\n"));
  process.env.HUBOT_ENV_BASE_PATH = temporary;
  process.env.CUTOVER_UNCHANGED = "same";
  delete process.env.CUTOVER_VALUE;
  const brain = new Brain(); brain.restore(null);
  const { bot, sent } = botFixture(brain);
  registerEnvironmentCommands(bot);

  await command(bot, "bot env load --filename=account.env --dry-run");
  assert.equal(process.env.CUTOVER_VALUE, undefined);
  assert(sent.some(item => String(item.messages[0]).includes("SLACK_SIGNING_SECRET=***")));
  assert.equal(sent.some(item => String(item.messages[0]).includes("never-display")), false);

  await command(bot, "bot env load --filename=account.env");
  assert.equal(process.env.CUTOVER_VALUE, "new-value");
  assert.equal(process.env.CUTOVER_UNCHANGED, "same");
  assert.equal(process.env.SLACK_SIGNING_SECRET, "never-display");
  assert.deepEqual(brain.get("hubot-env"), { env: {
    CUTOVER_VALUE: "new-value",
    SLACK_SIGNING_SECRET: "never-display",
  } });

  await command(bot, "bot env flush all --dry-run");
  assert.equal(process.env.CUTOVER_VALUE, "new-value");
  assert.equal(sent.some(item => String(item.messages[0]).includes("never-display")), false);
  await command(bot, "bot env flush all");
  assert.equal(process.env.CUTOVER_VALUE, undefined);
  assert.equal(process.env.SLACK_SIGNING_SECRET, undefined);
  assert.equal(brain.get("hubot-env"), null);
  // Variables not loaded by the command are left untouched.
  assert.equal(process.env.CUTOVER_UNCHANGED, "same");
});

test("new bot naming variables take precedence while legacy names remain compatible", () => {
  const required = { SLACK_BOT_TOKEN: "test", SLACK_SIGNING_SECRET: "secret" };
  assert.equal(boltConfiguration({ ...required, BOT_NAME: "new", HUBOT_NAME: "old" }, "1").name, "new");
  assert.equal(boltConfiguration({ ...required, HUBOT_NAME: "old" }, "1").name, "old");
  assert.equal(boltConfiguration({ ...required, BOT_ALIAS: "new", HUBOT_ALIAS: "old" }, "1").alias, "new");
});

test("production entrypoint import is offline and exports only explicit startup", () => {
  const main = require("../scripts/main");
  assert.deepEqual(Object.keys(main), ["run"]);
  assert.equal(typeof main.run, "function");
});

test("sensitive commands fail closed without configured admins and reject chat roles/bots", async t => {
  preserveEnvironment(t, ["BOT_ADMIN_IDS"]);
  for (const admin of ["", "UOTHER", "U1"]) {
    process.env.BOT_ADMIN_IDS = admin;
    const { bot, sent } = botFixture();
    registerEnvironmentCommands(bot);
    require("../scripts/storage")(bot);
    require("../scripts/ping")(bot);
    require("../scripts/events")(bot);
    let stopped = false;
    bot.on("shutdown", () => { stopped = true; });
    const user = { id: "U1", name: "alice", room: "C1", roles: ["admin", "maintainer"], slack: { is_bot: admin === "U1" } };
    for (const text of ["env current", "env file", "env load --filename=secret", "env flush all", "show storage", "show users", "die", "fake event shutdown"])
      await bot.receive(new TextMessage(user, `bot ${text}`, "C1"));
    await bot.flush();
    assert.equal(sent.length, 8);
    assert(sent.every(item => item.messages[0].includes("restricted")));
    assert.equal(stopped, false);
    assert.equal(bot.brain.get("hubot-env"), null);
  }
});

test("only a configured admin can emit a fake event", async t => {
  preserveEnvironment(t, ["BOT_ADMIN_IDS"]);
  process.env.BOT_ADMIN_IDS = "U1";
  const { bot, sent } = botFixture();
  require("../scripts/events")(bot);
  let emitted = 0;
  bot.on("debug", () => { emitted++; });
  await command(bot, "bot fake event debug");
  assert.equal(emitted, 1);
  assert(sent.some(item => item.messages[0].includes("fake event 'debug' triggered")));
});

test("admin diagnostics redact URL/key credentials and user emails without modifying memory", async t => {
  const sensitive = ["REDIS_URL", "REDISTOGO_URL", "HUBOT_GOOGLE_CSE_KEY", "MIRROR_SCRIPT_URL", "INFO_SPREADSHEET_URL"];
  preserveEnvironment(t, ["BOT_ADMIN_IDS", ...sensitive]);
  process.env.BOT_ADMIN_IDS = "U1";
  sensitive.forEach(key => { process.env[key] = "never-display-this"; });
  const { bot, sent } = botFixture();
  bot.brain.userForId("U1", { name: "alice", email_address: "private@example.invalid", slack: { profile: { email: "raw@example.invalid" } } });
  bot.brain.set("hubot-env", { env: { SOME_SETTING: "stored-secret" } });
  bot.brain.set("REDIS_URL", "redis://password@redis");
  const before = JSON.stringify(bot.brain.data);
  registerEnvironmentCommands(bot);
  require("../scripts/storage")(bot);
  require("../scripts/ping")(bot);
  let stopped = false;
  bot.on("shutdown", () => { stopped = true; });
  for (const text of ["env current", "show storage", "show users", "die"]) await command(bot, `bot ${text}`);
  const output = sent.flatMap(item => item.messages).join("\n");
  for (const secret of ["never-display-this", "private@example.invalid", "raw@example.invalid", "stored-secret", "redis://password@redis"])
    assert.equal(output.includes(secret), false, secret);
  sensitive.forEach(key => assert(output.includes(`${key}=***`)));
  assert.equal(stopped, true);
  assert.equal(JSON.stringify(bot.brain.data), before);
});

test("environment loads reject traversal and absolute paths outside the configured directory", async t => {
  preserveEnvironment(t, ["BOT_ADMIN_IDS", "HUBOT_ENV_BASE_PATH", "TRAVERSAL_TEST"]);
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "bot-env-boundary-"));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const base = path.join(temporary, "allowed"); fs.mkdirSync(base);
  fs.writeFileSync(path.join(temporary, "outside.env"), "TRAVERSAL_TEST=secret-file-content");
  fs.writeFileSync(path.join(base, "safe.env"), "BOT_ADMIN_IDS=UATTACKER\nHUBOT_ENV_BASE_PATH=/\nTRAVERSAL_TEST=allowed");
  process.env.BOT_ADMIN_IDS = "U1"; process.env.HUBOT_ENV_BASE_PATH = base;
  delete process.env.TRAVERSAL_TEST;
  const { bot, sent } = botFixture(); registerEnvironmentCommands(bot);
  for (const filename of ["../outside.env", path.join(temporary, "outside.env")])
    await command(bot, `bot env load --filename=${filename}`);
  assert.equal(process.env.TRAVERSAL_TEST, undefined);
  assert.equal(bot.brain.get("hubot-env"), null);
  assert(sent.every(item => item.messages[0].startsWith("Error:")));
  await command(bot, "bot env load --filename=safe.env");
  assert.equal(process.env.TRAVERSAL_TEST, "allowed");
  assert.equal(process.env.BOT_ADMIN_IDS, "U1");
  assert.equal(process.env.HUBOT_ENV_BASE_PATH, base);
  assert.deepEqual(bot.brain.get("hubot-env"), { env: { TRAVERSAL_TEST: "allowed" } });
});

test("environment loads resolve directory links before enforcing their boundary", async t => {
  preserveEnvironment(t, ["BOT_ADMIN_IDS", "HUBOT_ENV_BASE_PATH"]);
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "bot-env-link-"));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const base = path.join(temporary, "allowed"), outside = path.join(temporary, "outside");
  fs.mkdirSync(base); fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, "secret.env"), "SECRET=never-display");
  fs.symlinkSync(outside, path.join(base, "link"), process.platform === "win32" ? "junction" : "dir");
  process.env.BOT_ADMIN_IDS = "U1"; process.env.HUBOT_ENV_BASE_PATH = base;
  const { bot, sent } = botFixture(); registerEnvironmentCommands(bot);
  await command(bot, "bot env load --filename=link/secret.env --dry-run");
  assert.equal(sent.length, 1);
  assert.match(sent[0].messages[0], /^Error:/);
});

test("persisted settings cannot restore a different administrator policy", t => {
  preserveEnvironment(t, ["BOT_ADMIN_IDS", "HUBOT_ENV_BASE_PATH", "NODE_OPTIONS", "NODE_PATH"]);
  process.env.BOT_ADMIN_IDS = "U1"; process.env.HUBOT_ENV_BASE_PATH = "trusted";
  const brain = new Brain();
  brain.set("hubot-env", { env: { BOT_ADMIN_IDS: "UATTACKER", HUBOT_ENV_BASE_PATH: "/", NODE_OPTIONS: "--inspect", NODE_PATH: "untrusted" } });
  assert.equal(restorePersistedEnvironment(brain, logger), 0);
  assert.equal(process.env.BOT_ADMIN_IDS, "U1");
  assert.equal(process.env.HUBOT_ENV_BASE_PATH, "trusted");
});

test("update db caps concurrency and refuses overlapping runs", async () => {
  const { bot, sent } = botFixture();
  for (let i = 0; i < 12; i++) bot.brain.userForId(`U${i}`, { name: "old" });
  bot.brain.userForId("bot:B1", { name: "integration" });
  let release, active = 0, max = 0, calls = 0;
  const gate = new Promise(resolve => { release = resolve; });
  bot.slack.userInfo = async id => {
    calls++; active++; max = Math.max(max, active);
    await gate; active--; return { id, name: `name-${id}` };
  };
  require("../scripts/update-names")(bot);
  const first = command(bot, "bot update db");
  await new Promise(resolve => setImmediate(resolve));
  await command(bot, "bot update db");
  assert.equal(calls, 2);
  assert(sent.some(item => item.messages[0].includes("already running")));
  release(); await first;
  assert.equal(max, 2); assert.equal(calls, 12);
  assert.equal(bot.brain.data.users["bot:B1"].name, "integration");
  assert(sent.some(item => item.messages[0] === "Updated names for 12 out of 12 users"));
});

test("replacement quote parser preserves output and malformed-response fallback", async () => {
  const { bot, sent } = botFixture();
  let html = "<blockquote><p>A &amp; B</p><footer><cite>Author</cite></footer></blockquote>";
  bot.http = () => ({ get: () => callback => callback(null, { statusCode: 200 }, html) });
  require("../scripts/random-quote")(bot);
  await command(bot, "bot random quote");
  assert.equal(sent[0].messages[0], "_A &amp; B_ - Author");
  html = "<html>not a quote</html>";
  await command(bot, "bot random quote");
  assert.equal(sent[1].messages[0], "_error_");
});

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

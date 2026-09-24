"use strict";

const assert = require("assert");

const logger = {
  debug() {},
  error() {},
  info() {},
  warning() {},
};

function test(name, fn) {
  try {
    fn();
    process.stdout.write(`ok - ${name}\n`);
  } catch (error) {
    process.stderr.write(`not ok - ${name}\n${error.stack}\n`);
    process.exitCode = 1;
  }
}

test("batch score ignores an empty spreadsheet", () => {
  const util = require("../scripts/util");
  const originalInfo = util.info;
  util.info = (callback) => callback(null, "");

  let handler;
  const store = {};
  require("../scripts/batch-score")({
    brain: {
      get: (key) => store[key],
      set: (key, value) => {
        store[key] = value;
      },
    },
    logger,
    respond: (regex, callback) => {
      handler = callback;
    },
  });

  const sent = [];
  handler({
    match: ["score f20", "20", undefined],
    send: (message) => sent.push(message),
  });
  util.info = originalInfo;
  assert.deepStrictEqual(sent, []);
});

test("most-spoken-words loads without optional native classifiers", () => {
  assert.strictEqual(typeof require("../scripts/most-spoken-words"), "function");
});

test("detailed score handles a fresh brain", () => {
  let handler;
  require("../scripts/detailed-score")({
    brain: { data: { users: {} }, get: () => undefined },
    respond: (regex, callback) => {
      handler = callback;
    },
  });

  const sent = [];
  handler({
    match: ["detailed score bob", "bob", undefined],
    send: (message) => sent.push(message),
  });
  assert.deepStrictEqual(sent, ["Sorry ! No such user"]);
});

test("help filters are treated as text, not executable regexes", () => {
  let handler;
  require("../scripts/help")({
    alias: undefined,
    helpCommands: () => ["hubot ping"],
    name: "bot",
    respond: (regex, callback) => {
      handler = callback;
    },
    router: { get() {} },
  });

  const sent = [];
  handler({
    match: ["help [", "["],
    send: (message) => sent.push(message),
  });
  assert.deepStrictEqual(sent, ["No available commands match ["]);
});

test("seen preserves case-sensitive channel identifiers", () => {
  let hearHandler;
  const brainData = { users: {} };
  require("../scripts/seen")({
    brain: {
      data: brainData,
      on: (event, callback) => callback(),
    },
    hear: (regex, callback) => {
      hearHandler = callback;
    },
    logger,
    respond() {},
  });

  hearHandler({
    message: {
      text: "hello",
      user: { name: "Alice", room: "CAbC123" },
    },
  });
  assert.strictEqual(brainData.seen.alice.chan, "CAbC123");
});

test("Google Images handles a null network response", () => {
  const previousId = process.env.HUBOT_GOOGLE_CSE_ID;
  const previousKey = process.env.HUBOT_GOOGLE_CSE_KEY;
  process.env.HUBOT_GOOGLE_CSE_ID = "test-cse";
  process.env.HUBOT_GOOGLE_CSE_KEY = "test-key";

  let handler;
  require("../scripts/google-images")({
    hear() {},
    respond: (regex, callback) => {
      if (regex.test("image me cats")) {
        handler = callback;
      }
    },
  });

  const sent = [];
  const http = {
    query() {
      return this;
    },
    get() {
      return (callback) => callback(new Error("offline"), null, null);
    },
  };
  handler({
    http: () => http,
    match: ["image me cats", "image", " me", "cats"],
    robot: { logger },
    send: (message) => sent.push(message),
  });

  if (previousId === undefined) delete process.env.HUBOT_GOOGLE_CSE_ID;
  else process.env.HUBOT_GOOGLE_CSE_ID = previousId;
  if (previousKey === undefined) delete process.env.HUBOT_GOOGLE_CSE_KEY;
  else process.env.HUBOT_GOOGLE_CSE_KEY = previousKey;
  assert.strictEqual(sent.length, 1);
  assert.ok(/Encountered an error/.test(sent[0]));
});

test("translation detects the source language and reports API quota failures", () => {
  const previousKey = process.env.HUBOT_GOOGLE_TRANSLATE_API_KEY;
  const modulePath = require.resolve("../scripts/translate");
  process.env.HUBOT_GOOGLE_TRANSLATE_API_KEY = "offline-translation-key";
  delete require.cache[modulePath];
  try {
    let handler;
    require(modulePath)({ respond: (_pattern, callback) => { handler = callback; }, emit() {} });
    const run = (match, statusCode, response) => {
      const sent = [];
      let query;
      const http = {
        query(params) { query = params; return this; },
        get() { return callback => callback(null, { statusCode }, JSON.stringify(response)); },
      };
      handler({ match, http: () => http, send: message => sent.push(message) });
      return { query, sent };
    };

    const automatic = run(["translate me hola", undefined, undefined, " hola"], 200,
      { data: { translations: [{ detectedSourceLanguage: "es", translatedText: "hello" }] } });
    assert.strictEqual(automatic.query.source, undefined);
    assert.strictEqual(automatic.query.q, '"hola"');
    assert.deepStrictEqual(automatic.sent, ['"hola" is Spanish for hello']);

    const explicit = run(["translate me from French into English bonjour", "French", "English", " bonjour"], 200,
      { data: { translations: [{ translatedText: "hello" }] } });
    assert.strictEqual(explicit.query.source, "fr");
    assert.deepStrictEqual(explicit.sent, ['The French "bonjour" translates as hello in English']);

    const quota = run(["translate me hola", undefined, undefined, " hola"], 403,
      { error: { message: "User Rate Limit Exceeded" } });
    assert.deepStrictEqual(quota.sent, ["Google Translate quota exceeded; check the project's Cloud Translation quotas."]);
    const invalid = run(["translate me hola", undefined, undefined, " hola"], 400,
      { error: { message: "Invalid Value" } });
    assert.deepStrictEqual(invalid.sent, ["Google Translate request failed (HTTP 400)."]);
  } finally {
    if (previousKey === undefined) delete process.env.HUBOT_GOOGLE_TRANSLATE_API_KEY;
    else process.env.HUBOT_GOOGLE_TRANSLATE_API_KEY = previousKey;
    delete require.cache[modulePath];
  }
});

test("announcement webhook completes its HTTP response", () => {
  const previousToken = process.env.HUBOT_ENV_AUTH_TOKEN;
  process.env.HUBOT_ENV_AUTH_TOKEN = "test-token";

  let slackHandler;
  const sent = [];
  require("../scripts/httpd")({
    http() {},
    logger,
    name: "bot",
    router: {
      get() {},
      post: (path, callback) => {
        if (path === "/hubot/slack") slackHandler = callback;
      },
    },
    send: (...args) => sent.push(args),
    version: "test",
  });

  const response = {
    body: undefined,
    statusCode: undefined,
    writeHead(code) {
      this.statusCode = code;
    },
    end(body) {
      this.body = body;
    },
  };
  slackHandler(
    {
      body: { queryResult: { parameters: { name: "", any: "hello" } } },
      headers: { authorization: "test-token" },
    },
    response,
  );

  if (previousToken === undefined) delete process.env.HUBOT_ENV_AUTH_TOKEN;
  else process.env.HUBOT_ENV_AUTH_TOKEN = previousToken;
  assert.strictEqual(response.statusCode, 200);
  assert.ok(/Announcement sent/.test(response.body));
  assert.strictEqual(sent.length, 1);
});

test("removing keys does not skip adjacent entries", () => {
  const entries = [
    { holder: "alice", owner: "bob" },
    { holder: "alice", owner: "carol" },
  ];
  let handler;
  require("../scripts/keys")({
    brain: {
      get: () => entries,
      set() {},
      userForName: () => ({ id: "1", name: "alice" }),
    },
    respond: (regex, callback) => {
      if (regex.test("i dont have keys")) handler = callback;
    },
  });

  handler({
    message: { user: { name: "alice" } },
    send() {},
  });
  assert.strictEqual(entries.length, 0);
});

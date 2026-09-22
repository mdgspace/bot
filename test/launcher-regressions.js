"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const packageJson = require(path.join(root, "package.json"));
const packageLock = require(path.join(root, "package-lock.json"));
const unixLauncher = read("bin/bot");
const windowsLauncher = read("bin/bot.cmd");
const legacyUnixLauncher = read("bin/hubot");
const legacyWindowsLauncher = read("bin/hubot.cmd");
const dockerfile = read("Dockerfile");

function test(name, fn) {
  try {
    fn();
    process.stdout.write(`ok - ${name}\n`);
  } catch (error) {
    process.stderr.write(`not ok - ${name}\n${error.stack}\n`);
    process.exitCode = 1;
  }
}

function assertOrdered(contents, commands) {
  let previous = -1;
  for (const command of commands) {
    const index = contents.indexOf(command);
    assert.notEqual(index, -1, `Missing command: ${command}`);
    assert(index > previous, `Command is out of order: ${command}`);
    previous = index;
  }
}

test("production installs exclude the TypeScript build toolchain", () => {
  assert.equal(packageJson.devDependencies.typescript, "5.9.3");
  assert.equal(packageJson.devDependencies["@types/node"], "^24.0.0");
  assert.equal(packageJson.dependencies.typescript, undefined);
  assert.equal(packageJson.dependencies["@types/node"], undefined);
});

test("Hubot runtime packages and manifests are removed", () => {
  for (const name of ["hubot", "hubot-env", "hubot-redis-brain", "hubot-scripts", "hubot-slack"]) {
    assert.equal(packageJson.dependencies[name], undefined, name);
    assert.equal(packageLock.packages[`node_modules/${name}`], undefined, name);
  }
  assert.equal(fs.existsSync(path.join(root, "external-scripts.json")), false);
  assert.equal(fs.existsSync(path.join(root, "hubot-scripts.json")), false);
});

test("Unix Bolt launcher validates and launches without installing at boot", () => {
  assertOrdered(unixLauncher, [
    "if [ ! -f scripts/main.js ]",
    "exec node --env-file-if-exists=.env scripts/main.js",
  ]);
  assert.equal(unixLauncher.includes("node_modules/.bin/hubot"), false);
});

test("Windows Bolt launcher validates and launches without installing at boot", () => {
  assertOrdered(windowsLauncher, [
    "if not exist scripts\\main.js",
    "node --env-file-if-exists=.env scripts\\main.js",
  ]);
  assert.equal(windowsLauncher.includes("node_modules\\.bin\\hubot"), false);
  assert.match(windowsLauncher, /set "BOT_NAME=%~2"/);
  assert.match(windowsLauncher, /if \/I not "%~2"=="slack"/);
});

test("legacy launcher paths forward to Bolt launchers", () => {
  assert.match(legacyUnixLauncher, /exec .*\/bot/);
  assert.match(legacyWindowsLauncher, /bot\.cmd/);
  assert.equal(legacyUnixLauncher.includes("node_modules/.bin/hubot"), false);
  assert.equal(legacyWindowsLauncher.includes("node_modules\\.bin\\hubot"), false);
});

test("npm start and development mode use the Bolt entrypoint", () => {
  assert.equal(packageJson.scripts.prestart, undefined);
  assert.equal(packageJson.scripts.start, "node --env-file-if-exists=.env scripts/main.js");
  assert(packageJson.scripts.dev.includes("node --env-file-if-exists=.env scripts/main.js"));
  assert.equal(packageJson.scripts.dev.includes("shell"), false);
});

test("Docker builds TypeScript and starts Bolt without Hubot", () => {
  assert.match(dockerfile, /RUN npm run build/);
  assert.match(dockerfile, /CMD \["node", "scripts\/main\.js"\]/);
  assert.equal(dockerfile.includes("node_modules/.bin/hubot"), false);
  assert.equal(dockerfile.includes("HUBOT_SLACK"), false);
  assert.match(read(".gitignore"), /^scripts\/\*\.js$/m);
});

test("Procfile uses a web process and every deployment path reaches Bolt", () => {
  assert.equal(read("Procfile").trim(), "web: node scripts/main.js");
  assert(read("start_bot.sh").includes("exec npm run start"));
  assert.match(read("start_bot.sh"), /if \[ ! -f scripts\/main\.js \]/);
  assert.match(read("start_bot.sh"), /npm ci .* npm run build first/);
  assert(read("docker-compose.yml").includes("8080"));
  assert(read("dev_docker-compose.yml").includes("REDIS_URL: redis://redis:6379"));
});

test("fresh Slack app setup requires channel membership", () => {
  const readme = read("README.md");
  assert.match(readme, /invite the new bot to every public channel/i);
  assert.match(readme, /\/invite @<new-app-bot-name>/);
  assert.match(readme, /including `#general`/);
});

test("the compiled entrypoint is import-safe and does not require credentials", () => {
  const entrypoint = require("../scripts/main");
  assert.equal(typeof entrypoint.run, "function");
});

"use strict";

var assert = require("assert");
var fs = require("fs");
var path = require("path");

var projectRoot = path.resolve(__dirname, "..");
var packageJson = require(path.join(projectRoot, "package.json"));
var unixLauncher = fs.readFileSync(
  path.join(projectRoot, "bin", "hubot"),
  "utf8",
);
var windowsLauncher = fs.readFileSync(
  path.join(projectRoot, "bin", "hubot.cmd"),
  "utf8",
);
var dockerfile = fs.readFileSync(
  path.join(projectRoot, "Dockerfile"),
  "utf8",
);
var gitignore = fs.readFileSync(
  path.join(projectRoot, ".gitignore"),
  "utf8",
);

function test(name, fn) {
  try {
    fn();
    process.stdout.write("ok - " + name + "\n");
  } catch (error) {
    process.stderr.write("not ok - " + name + "\n" + error.stack + "\n");
    process.exitCode = 1;
  }
}

function assertOrdered(contents, commands) {
  var previousIndex = -1;

  commands.forEach(function (command) {
    var index = contents.indexOf(command);
    assert.ok(index !== -1, "Missing command: " + command);
    assert.ok(index > previousIndex, "Command is out of order: " + command);
    previousIndex = index;
  });
}

test("production installs include the TypeScript build toolchain", function () {
  assert.strictEqual(packageJson.dependencies.typescript, "5.9.3");
  assert.strictEqual(packageJson.dependencies["@types/node"], "^24.0.0");
  assert.strictEqual(packageJson.devDependencies.typescript, undefined);
  assert.strictEqual(packageJson.devDependencies["@types/node"], undefined);
});

test("the Unix launcher installs, builds, validates, and launches in order", function () {
  assertOrdered(unixLauncher, [
    "npm install",
    "npm run build",
    "no compiled JavaScript files",
    "exec node_modules/.bin/hubot",
  ]);
});

test("the Windows launcher installs, builds, validates, and launches in order", function () {
  assertOrdered(windowsLauncher, [
    "call npm install",
    "call npm run build",
    "no compiled JavaScript files",
    "call node_modules\\.bin\\hubot.cmd",
  ]);
});

test("npm start delegates compilation to bin/hubot", function () {
  assert.ok(packageJson.scripts.start.indexOf("bin/hubot") !== -1);
  assert.strictEqual(packageJson.scripts.start.indexOf("npm run build"), -1);
});

test("clean Docker deployments build ignored scripts through bin/hubot", function () {
  assert.ok(/CMD .*bin\/hubot/.test(dockerfile));
  assert.ok(/^scripts\/\*\.js$/m.test(gitignore));
  assert.ok(unixLauncher.indexOf("npm run build") !== -1);
});

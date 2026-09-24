// Description:
//   Manage selected environment variables in process.env and persistent memory.
//
// Commands:
//   hubot env current - Displays all current environment variables
//   hubot env current --prefix=[prefix] - Displays matching environment variables
//   hubot env file - Lists files under HUBOT_ENV_BASE_PATH
//   hubot env flush all --dry-run - Shows persisted variables without removing them
//   hubot env flush all - Removes variables previously loaded through this command
//   hubot env load --filename=[filename] --dry-run - Shows a file without applying it
//   hubot env load --filename=[filename] - Loads a file into the environment and memory

import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { resolve, relative, isAbsolute, sep } from "node:path";
import { inspect } from "node:util";
import type { Brain, Logger, Robot } from "./runtime/types";
import { adminGuard } from "./runtime/admin";

const BRAIN_KEY = "hubot-env";
const ALWAYS_HIDDEN = new Set([
  "SLACK_BOT_TOKEN",
  "SLACK_SIGNING_SECRET",
  "SLACK_APP_TOKEN",
  "SLACK_API_TOKEN",
]);
const SENSITIVE_KEY_PARTS = [
  "token",
  "secret",
  "password",
  "api_key",
  "private_key",
  "credential",
  "key", "url", "auth", "pass",
];

const PROTECTED_KEYS = new Set(["BOT_ADMIN_IDS", "HUBOT_ENV_BASE_PATH", "NODE_OPTIONS", "NODE_PATH"]);

interface PersistedEnvironment {
  env: Record<string, string>;
}

function storedEnvironment(brain: Brain): PersistedEnvironment | null {
  const value: unknown = brain.get(BRAIN_KEY);
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const env = (value as { env?: unknown }).env;
  if (!env || typeof env !== "object" || Array.isArray(env)) return null;
  return value as PersistedEnvironment;
}

function hiddenWords(): string[] {
  return (process.env.HUBOT_ENV_HIDDEN_WORDS ?? "")
    .split(",")
    .map((word) => word.trim().toLowerCase())
    .filter(Boolean);
}

function displayValue(key: string, value: string): string {
  const lowerKey = key.toLowerCase();
  return ALWAYS_HIDDEN.has(key.toUpperCase()) ||
    SENSITIVE_KEY_PARTS.some((word) => lowerKey.includes(word)) ||
    hiddenWords().some((word) => lowerKey.includes(word))
    ? "***"
    : value;
}

/** Restore the exact hubot-env brain shape before importing command modules. */
export function restorePersistedEnvironment(brain: Brain, logger: Logger): number {
  const stored = storedEnvironment(brain);
  if (!stored) return 0;
  let restored = 0;
  for (const [key, value] of Object.entries(stored.env)) {
    if (PROTECTED_KEYS.has(key.toUpperCase())) continue;
    if (typeof value !== "string") {
      logger.warning(`Ignoring non-string persisted environment value: ${key}`);
      continue;
    }
    process.env[key] = value;
    restored++;
  }
  logger.info(`Restored ${restored} persisted environment variable(s)`);
  return restored;
}

function parseEnvironmentFile(contents: string): Record<string, string> {
  const parsed: Record<string, string> = {};
  for (let line of contents.split(/\r?\n|\r/)) {
    if (!/\s*=\s*/.test(line)) continue;
    line = line.replace("exports ", "");
    if (/^\s*#/.test(line)) continue;
    const match = /^([^=]+)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const key = match[1];
    const quoted = /^(['"]?)([^\n]*)\1$/.exec(match[2]);
    parsed[key] = quoted?.[2] ?? match[2];
  }
  return parsed;
}

function filePreview(contents: string): string {
  const lines: string[] = [];
  for (const line of contents.split("\n")) {
    const pieces = line.split("=");
    if (pieces.length !== 2) continue;
    lines.push(`${pieces[0]}=${displayValue(pieces[0], pieces[1])}`);
  }
  return lines.join("\n") || "[None]";
}

export function registerEnvironmentCommands(robot: Robot): void {
  const allowed = adminGuard();
  const basePath = process.env.HUBOT_ENV_BASE_PATH;
  robot.respond(/env current($| --prefix=)(.*)$/i, (msg) => {
    if (!allowed(msg)) return;
    const prefix = msg.match[2].trim().toLowerCase();
    const values = Object.entries(process.env)
      .filter(([key]) => key.toLowerCase().startsWith(prefix))
      .map(([key, value]) => `${key}=${displayValue(key, value ?? "")}`);
    msg.send(values.join("\n") || "[None]");
  });

  robot.respond(/env file$/i, (msg) => {
    if (!allowed(msg)) return;
    const files = basePath && existsSync(basePath) ? readdirSync(basePath) : [];
    msg.send(files.join("\n") || "[None]");
  });

  robot.respond(/env flush all(.*)$/i, (msg) => {
    if (!allowed(msg)) return;
    const stored = storedEnvironment(robot.brain);
    if (!stored) {
      msg.send("Flush nothing against empty data in redis");
      return;
    }
    const dryRun = /--dry-run/.test(msg.match[1]);
    msg.send(`Flushing all --dry-run=${dryRun}...`);
    if (dryRun) {
      const redacted = Object.fromEntries(
        Object.entries(stored.env).map(([key, value]) => [key, displayValue(key, value)]),
      );
      msg.send(`Complete dry-run: loadedData=${inspect(redacted, false, null)}`);
      return;
    }
    for (const key of Object.keys(stored.env)) if (!PROTECTED_KEYS.has(key.toUpperCase())) delete process.env[key];
    robot.brain.set(BRAIN_KEY, null);
    msg.send("Complete flushing all");
  });

  robot.respond(/env load(.*)$/i, (msg) => {
    if (!allowed(msg)) return;
    const args = msg.match[1];
    const dryRun = /--dry-run/.test(args);
    const filename = /--filename=(.*?)( |$)/.exec(args)?.[1];
    if (!filename) {
      msg.send("Error: Empty filename is invalid");
      return;
    }
    let filePath: string;
    try {
      if (!basePath) throw new Error("No environment directory configured");
      const base = realpathSync(basePath);
      // Resolve symlinks as well as ../, including Windows absolute/UNC paths.
      filePath = realpathSync(resolve(base, filename));
      const local = relative(base, filePath);
      if (!local || isAbsolute(local) || local === ".." || local.startsWith(`..${sep}`) || !statSync(filePath).isFile())
        throw new Error("Path outside environment directory");
    } catch {
      msg.send("Error: Environment file must be a regular file inside HUBOT_ENV_BASE_PATH.");
      return;
    }
    msg.send(`Loading env --filename=${filename}, --dry-run=${dryRun}...`);
    const contents = readFileSync(filePath, "utf8");
    if (dryRun) {
      msg.send(filePreview(contents));
      msg.send("Complete dry-run");
      return;
    }

    const previous = { ...process.env };
    const parsed = parseEnvironmentFile(contents);
    for (const key of Object.keys(parsed)) if (PROTECTED_KEYS.has(key.toUpperCase())) delete parsed[key];
    for (const [key, value] of Object.entries(parsed)) process.env[key] = value;
    const changed = Object.entries(parsed).filter(
      ([key, value]) => key !== "ENV_FILE" && previous[key] !== value,
    );
    msg.send(
      changed.map(([key, value]) => `${key}=${displayValue(key, value)}`).join("\n") ||
        "[None]",
    );
    const stored = storedEnvironment(robot.brain) ?? { env: {} };
    for (const [key, value] of changed) stored.env[key] = value;
    robot.brain.set(BRAIN_KEY, stored);
  });
}

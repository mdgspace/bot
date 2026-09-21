import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Bot } from "./bot";
import type { Robot } from "./types";

export const SCRIPT_NAMES = [
  "batch-score",
  "birthday",
  "bye",
  "detailed-score",
  "events",
  "fb-feed",
  "fblikes",
  "google-images",
  "help",
  "httpd",
  "idlecheck",
  "info",
  "keys",
  "leaderboard",
  "maps",
  "middleware",
  "mirror",
  "most-spoken-words",
  "openclose",
  "ping",
  "pugme",
  "random-quote",
  "roles",
  "rules",
  "seen",
  "shipit",
  "skipped-word",
  "storage",
  "toss",
  "translate",
  "update-names",
  "wail",
  "youtube",
] as const;

export interface ScriptLoaderOptions {
  scriptsDirectory?: string;
  load?: (path: string) => unknown;
  read?: (path: string) => string;
}

export function loadScripts(bot: Bot, options: ScriptLoaderOptions = {}): void {
  const scriptsDirectory = options.scriptsDirectory ?? dirname(__dirname);
  const load = options.load ?? require;
  const read = options.read ?? ((path: string) => readFileSync(path, "utf8"));
  for (const name of SCRIPT_NAMES) {
    const path = join(scriptsDirectory, `${name}.js`);
    bot.addHelp(read(path));
    const script = load(path);
    if (typeof script !== "function") throw new TypeError(`Script ${name} does not export a function`);
    (script as (robot: Robot) => void)(bot);
  }
}

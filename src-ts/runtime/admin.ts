import type { Response } from "./types";

/** Operator-set Slack user IDs, never the roles that users can edit in chat. */
export function adminGuard(env: NodeJS.ProcessEnv = process.env): (response: Response) => boolean {
  const admins = new Set((env.BOT_ADMIN_IDS ?? "").split(/[,\s]+/).filter(Boolean));
  return response => {
    if (admins.has(response.message.user.id) && !response.message.user.slack?.is_bot) return true;
    response.send("This command is restricted to bot administrators.");
    return false;
  };
}

export function redactStorage(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value, (key, item) =>
    /token|secret|pass|key|credential|url|auth|email|^slack$|^hubot-env$/i.test(key) ? "***" : item));
}

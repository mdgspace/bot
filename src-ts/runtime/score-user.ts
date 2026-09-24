import type { Response, Robot } from "./types";

/** Scores remain keyed by lowercase Slack usernames in the existing brain. */
export function scoreNameForId(robot: Robot, id: string): string | undefined {
  const name = robot.brain.data.users[id]?.name;
  return typeof name === "string" ? name.toLowerCase() : undefined;
}

export function scoreNameForQuery(robot: Robot, msg: Response, input: string): string {
  const value = input.trim();
  const selectedId = value.startsWith("@") ? msg.message.slackUserMentions?.[0] : undefined;
  return (selectedId && scoreNameForId(robot, selectedId))
    || scoreNameForId(robot, value)
    || value.replace(/^@/, "").toLowerCase();
}

/** The member sheet may contain Slack IDs or older username entries. */
export function scoreForMember(robot: Robot, field: Record<string, number>, member: string): number {
  const name = scoreNameForId(robot, member);
  return (name === undefined ? undefined : field[name]) ?? field[member.toLowerCase()] ?? 0;
}

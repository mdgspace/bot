// Description:
//   Track the holders of numbered lab keys. k0 is the master key.
//   Unspecified keys are tracked separately as unknown, never as k0.
//
// Commands:
//   bot who has keys - list every recorded key and its holders
//   bot who has k1 - list all holders of k1 (also works for k0 and any other kN)
//   bot who has unknown keys - list holders whose key number is unknown
//   bot i have k1 - add yourself to a numbered key
//   bot <name> has k1 - add another holder to a numbered key
//   bot i have keys - add yourself to unknown keys
//   bot <name> has keys - add a holder to unknown keys
//   bot <name> has unknown keys - add a holder to unknown keys explicitly
//   bot i don't have k1 - remove yourself from one numbered key
//   bot i don't have unknown keys - remove yourself from unknown keys
//   bot i don't have keys - remove yourself from every key
//   bot i gave k1 to <name> - transfer one numbered key
//   bot i gave unknown keys to <name> - transfer unknown keys
//   bot i gave keys to <name> - transfer all your recorded keys

import type { Response, Robot, User } from "./runtime/types";

interface KeyHolder {
  id: string;
  name: string;
}

interface KeyRegistry {
  version: 1;
  groups: Record<string, KeyHolder[]>;
}

interface LegacyKeyEntry {
  holder: string;
  owner: string;
}

const REGISTRY_KEY = "key-holders-v2";
const LEGACY_KEY = "key";
const LEGACY_BACKUP_KEY = "key-legacy-backup";
const UNKNOWN = "unknown";
const EMPTY_MESSAGE = "Ah! Nobody informed me about the keys. Don't hold me responsible for this :expressionless:";
const NUMBERED_KEY = /^k(?:0|[1-9]\d*)$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isRegistry(value: unknown): value is KeyRegistry {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.groups)) return false;
  return Object.entries(value.groups).every(([key, holders]) =>
    (key === UNKNOWN || NUMBERED_KEY.test(key)) && Array.isArray(holders) &&
    holders.every((holder) => isRecord(holder) && typeof holder.id === "string" && typeof holder.name === "string"),
  );
}

function registry(robot: Robot): KeyRegistry {
  // The old `key` array is deliberately not imported: owner names do not
  // identify k0/k1/etc. It remains in the brain for manual recovery.
  if (!robot.brain.data?._private || !Object.hasOwn(robot.brain.data._private, REGISTRY_KEY)) {
    return { version: 1, groups: {} };
  }
  const value = robot.brain.get<unknown>(REGISTRY_KEY);
  if (!isRegistry(value)) throw new Error("Invalid key-holder registry; refusing to overwrite it");
  return value;
}

function holderId(user: User): string {
  return user.id || `name:${user.name.toLowerCase()}`;
}

function holderName(robot: Robot, holder: KeyHolder): string {
  return robot.brain.data?.users?.[holder.id]?.name || holder.name;
}

function groupLabel(group: string): string {
  return group === UNKNOWN ? "unknown keys" : group === "k0" ? "k0 (master key)" : group;
}

function describeGroup(robot: Robot, state: KeyRegistry, group: string): string {
  const names = (state.groups[group] ?? []).map((holder) => holderName(robot, holder));
  return `${groupLabel(group)}: ${names.length ? names.join(", ") : "no holders recorded"}`;
}

function addHolder(state: KeyRegistry, group: string, user: User): boolean {
  const holders = state.groups[group] ?? [];
  if (holders.some((holder) => holder.id === holderId(user))) return false;
  state.groups[group] = [...holders, { id: holderId(user), name: user.name }];
  return true;
}

function removeHolder(state: KeyRegistry, group: string, user: User): boolean {
  const holders = state.groups[group];
  if (!holders) return false;
  const remaining = holders.filter((holder) => holder.id !== holderId(user));
  if (remaining.length === holders.length) return false;
  state.groups[group] = remaining;
  return true;
}

function transferHolder(state: KeyRegistry, group: string, sender: User, recipient: User): boolean {
  if (!removeHolder(state, group, sender)) return false;
  addHolder(state, group, recipient);
  return true;
}

function removeLegacyAssignments(robot: Robot, user: User): number {
  const entries = robot.brain.get<unknown>(LEGACY_KEY);
  if (!Array.isArray(entries)) return 0;
  const oldEntries = entries as LegacyKeyEntry[];
  const matches = oldEntries.filter((entry) =>
    typeof entry?.holder === "string" && entry.holder.toLowerCase() === user.name.toLowerCase(),
  );
  if (!matches.length) return 0;

  // Preserve the pre-migration owner labels even when a holder explicitly
  // removes themselves. The legacy regression also expects the live array to
  // be updated in place, including adjacent matching entries.
  if (robot.brain.data?._private && !Object.hasOwn(robot.brain.data._private, LEGACY_BACKUP_KEY)) {
    robot.brain.set(LEGACY_BACKUP_KEY, structuredClone(oldEntries));
  }
  for (let index = oldEntries.length - 1; index >= 0; index--) {
    if (typeof oldEntries[index]?.holder === "string" &&
      oldEntries[index].holder.toLowerCase() === user.name.toLowerCase()) oldEntries.splice(index, 1);
  }
  robot.brain.set(LEGACY_KEY, oldEntries);
  return matches.length;
}

function getAmbiguousUserText(users: User[]): string {
  return `Be more specific, I know ${users.length} people named like that: ${users.map((user) => user.name).join(", ")}`;
}

function usersForKeyName(robot: Robot, input: string): User[] {
  const name = input.trim().replace(/^@/, "").toLowerCase();
  const users = Object.values(robot.brain.data.users);
  // Keep exact Slack usernames ahead of display/real names and fuzzy matches.
  const usernames = users.filter((user) => String(user.name ?? "").toLowerCase() === name);
  if (usernames.length) return usernames;
  const names = users.filter((user) =>
    [user.display_name, user.real_name].some(
      (candidate) => typeof candidate === "string" && candidate.toLowerCase() === name,
    ),
  );
  return names.length ? names : robot.brain.usersForFuzzyName(name);
}

function resolveHolder(robot: Robot, msg: Response, input: string): User | null {
  const name = input.trim();
  if (/^i$/i.test(name)) return msg.message.user;
  if (["you", robot.name.toLowerCase()].includes(name.replace(/^@/, "").toLowerCase())) {
    msg.send("The bot cannot hold lab keys.");
    return null;
  }
  if (name.startsWith("@") && msg.message.slackUserMentions?.length) {
    const selected = robot.brain.data.users[msg.message.slackUserMentions[0]];
    if (selected) return selected;
  }
  const users = usersForKeyName(robot, name);
  if (users.length === 1) return users[0];
  msg.send(users.length ? getAmbiguousUserText(users) : `${name}? Never heard of 'em`);
  return null;
}

export = (robot: Robot): void => {
  const save = (state: KeyRegistry): void => robot.brain.set(REGISTRY_KEY, state);

  const assign = (msg: Response, input: string, group: string): void => {
    const user = resolveHolder(robot, msg, input);
    if (!user) return;
    const state = registry(robot);
    const added = addHolder(state, group, user);
    if (added) save(state);
    msg.send(added
      ? `Okay, ${user.name} now holds ${groupLabel(group)}.`
      : `${user.name} is already listed for ${groupLabel(group)}.`);
  };

  const remove = (msg: Response, group: string): void => {
    const state = registry(robot);
    const removed = removeHolder(state, group, msg.message.user);
    if (removed) save(state);
    msg.send(removed
      ? `Okay, ${msg.message.user.name} no longer holds ${groupLabel(group)}.`
      : `I have no record of ${msg.message.user.name} holding ${groupLabel(group)}.`);
  };

  const transfer = (msg: Response, input: string, group?: string): void => {
    const recipient = resolveHolder(robot, msg, input);
    if (!recipient) return;
    const state = registry(robot);
    const groups = group ? [group] : Object.keys(state.groups);
    const changed = groups.filter((name) => transferHolder(state, name, msg.message.user, recipient));
    if (changed.length) save(state);
    msg.send(changed.length
      ? `Okay, ${recipient.name} now holds ${changed.map(groupLabel).join(", ")}.`
      : `I have no record of ${msg.message.user.name} holding ${group ? groupLabel(group) : "any keys"}.`);
  };

  robot.respond(/who(?: all)? (?:has|have) (?:the )?(k(?:0|[1-9]\d*))(?: keys?)?$/i, (msg) => {
    msg.send(describeGroup(robot, registry(robot), msg.match[1].toLowerCase()));
  });

  robot.respond(/who(?: all)? (?:has|have) unknown keys?$/i, (msg) => {
    msg.send(describeGroup(robot, registry(robot), UNKNOWN));
  });

  robot.respond(/who(?: all)? (?:has|have) (?:(?:the|a) )?keys?$/i, (msg) => {
    const state = registry(robot);
    const groups = Object.keys(state.groups)
      .filter((group) => group !== UNKNOWN)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    if (state.groups[UNKNOWN]?.length) groups.push(UNKNOWN);
    msg.send(groups.length
      ? groups.map((group) => describeGroup(robot, state, group)).join("\n")
      : EMPTY_MESSAGE);
  });

  robot.respond(/who(?: all)? (?:has|have) (.+)'s keys?$/i, (msg) => {
    msg.send(`Keys are now identified by k0, k1, etc. Use "bot who has kN" instead of ${msg.match[1]}'s name.`);
  });

  robot.respond(/i (?:don'?t|do not) (?:has|have) (?:the )?(k(?:0|[1-9]\d*))(?: keys?)?$/i, (msg) => {
    remove(msg, msg.match[1].toLowerCase());
  });

  robot.respond(/i (?:don'?t|do not) (?:has|have) unknown keys?$/i, (msg) => {
    remove(msg, UNKNOWN);
  });

  robot.respond(/i (?:don'?t|do not) (?:has|have) (?:(?:the|a) )?keys?$/i, (msg) => {
    const state = registry(robot);
    const removed = Object.keys(state.groups).filter((group) => removeHolder(state, group, msg.message.user));
    if (removed.length) save(state);
    const legacyRemoved = removeLegacyAssignments(robot, msg.message.user);
    msg.send(removed.length || legacyRemoved
      ? `Okay, ${msg.message.user.name} no longer holds any recorded keys.`
      : "Yes, I know buddy");
  });

  robot.respond(/i (?:have given|gave|had given) (?:the )?(k(?:0|[1-9]\d*))(?: keys?)? to (.+)$/i, (msg) => {
    transfer(msg, msg.match[2], msg.match[1].toLowerCase());
  });

  robot.respond(/i (?:have given|gave|had given) unknown keys? to (.+)$/i, (msg) => {
    transfer(msg, msg.match[1], UNKNOWN);
  });

  robot.respond(/i (?:have given|gave|had given) (?:(?:the|a) )?keys? to (.+)$/i, (msg) => {
    transfer(msg, msg.match[1]);
  });

  robot.respond(/^(?!(?:who(?: all)?|i\s+(?:don'?t|do not))\s)(\S.*?)\s+(?:has|have)\s+(?:the\s+)?(k(?:0|[1-9]\d*))(?:\s+keys?)?$/i, (msg) => {
    assign(msg, msg.match[1], msg.match[2].toLowerCase());
  });

  robot.respond(/^(?!(?:who(?: all)?|i\s+(?:don'?t|do not))\s)(\S.*?)\s+(?:has|have)\s+unknown keys?$/i, (msg) => {
    assign(msg, msg.match[1], UNKNOWN);
  });

  robot.respond(/^(?!(?:who(?: all)?|i\s+(?:don'?t|do not))\s)(\S.*?)\s+(?:has|have)\s+(?:(?:the|a)\s+)?keys?(?:\s+of\s+(.+))?$/i, (msg) => {
    const hint = msg.match[2]?.trim();
    // Old owner-based syntax is accepted, but never guesses a physical key.
    assign(msg, msg.match[1], hint && NUMBERED_KEY.test(hint) ? hint.toLowerCase() : UNKNOWN);
  });
};

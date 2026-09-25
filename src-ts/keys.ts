// Description:
//   Track the holders of numbered lab keys. k0 is the master key.
//   Numbered keys are k0 through k9; unnumbered keys use the kx group.
//
// Commands:
//   bot who has keys - list every recorded key and its holders
//   bot who has k1 - list all holders of k1 (also works for k0 through k9 and kx)
//   bot i have k1 - add yourself to a numbered key
//   bot <name> has k1 - add another holder to a numbered key
//   bot i have kx - add yourself to the unnumbered-key group
//   bot <name> has kx - add another holder to the unnumbered-key group
//   bot <name> has keys - add a holder to the unnumbered-key group
//   bot i don't have k1 - remove yourself from one numbered key
//   bot <name> doesn't have k1 - remove another holder from a numbered key
//   bot <name> doesn't have kx - remove another holder from the unnumbered-key group
//   bot i don't have kx - remove yourself from the unnumbered-key group
//   bot i don't have keys - remove yourself from every key
//   bot i gave k1 to <name> - transfer one numbered key
//   bot i gave kx to <name> - transfer the unnumbered-key group
//   bot i gave keys to <name> - transfer all your recorded keys

import type { Response, Robot, User } from "./runtime/types";

interface KeyHolder {
  id: string;
  name: string;
}

interface KeyRegistry {
  version: 2;
  groups: Record<string, KeyHolder[]>;
}

interface LegacyKeyRegistry {
  version: 1;
  groups: Record<string, KeyHolder[]>;
}

interface LegacyKeyEntry {
  holder: string;
  owner: string;
}

const REGISTRY_KEY = "key-holders-v2";
const UNSUPPORTED_GROUPS_BACKUP_KEY = "key-holders-v2-unsupported-backup";
const LEGACY_KEY = "key";
const LEGACY_BACKUP_KEY = "key-legacy-backup";
const UNKNOWN = "kx";
const LEGACY_UNKNOWN = "unknown";
const EMPTY_MESSAGE = "Ah! Nobody informed me about the keys. Don't hold me responsible for this :expressionless:";
const NUMBERED_KEY = /^k[0-9]$/i;
const LEGACY_NUMBERED_KEY = /^k(?:0|[1-9]\d*)$/i;
const NUMBERED_KEY_LIKE = /^k\d+$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isKeyHolder(value: unknown): value is KeyHolder {
  return isRecord(value) && typeof value.id === "string" && typeof value.name === "string";
}

function isSupportedGroup(key: string): boolean {
  return key === UNKNOWN || NUMBERED_KEY.test(key);
}

function isRegistry(value: unknown): value is KeyRegistry {
  if (!isRecord(value) || value.version !== 2 || !isRecord(value.groups)) return false;
  return Object.entries(value.groups).every(([key, holders]) =>
    isSupportedGroup(key) && Array.isArray(holders) && holders.every(isKeyHolder),
  );
}

function isLegacyRegistry(value: unknown): value is LegacyKeyRegistry {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.groups)) return false;
  return Object.entries(value.groups).every(([key, holders]) =>
    (key.toLowerCase() === LEGACY_UNKNOWN || key.toLowerCase() === UNKNOWN || LEGACY_NUMBERED_KEY.test(key)) &&
    Array.isArray(holders) && holders.every(isKeyHolder),
  );
}

function migrateRegistry(robot: Robot, legacy: LegacyKeyRegistry): KeyRegistry {
  const migrated: KeyRegistry = { version: 2, groups: {} };
  const unsupportedGroups: Record<string, KeyHolder[]> = {};

  for (const [legacyGroup, holders] of Object.entries(legacy.groups)) {
    const normalizedGroup = legacyGroup.toLowerCase();
    let group: string;
    if (normalizedGroup === LEGACY_UNKNOWN || normalizedGroup === UNKNOWN) {
      group = UNKNOWN;
    } else if (NUMBERED_KEY.test(normalizedGroup)) {
      group = normalizedGroup;
    } else {
      // Earlier versions allowed arbitrary kN groups. Preserve those records
      // for manual review instead of treating a known, out-of-range key as kx.
      unsupportedGroups[legacyGroup] = holders;
      continue;
    }

    const current = migrated.groups[group] ?? [];
    const seen = new Set(current.map((holder) => holder.id));
    for (const holder of holders) {
      if (!seen.has(holder.id)) {
        current.push(holder);
        seen.add(holder.id);
      }
    }
    migrated.groups[group] = current;
  }

  if (Object.keys(unsupportedGroups).length) {
    robot.brain.set(UNSUPPORTED_GROUPS_BACKUP_KEY, { version: 1, groups: unsupportedGroups });
  }
  robot.brain.set(REGISTRY_KEY, migrated);
  return migrated;
}

function registry(robot: Robot): KeyRegistry {
  // The old `key` array is deliberately not imported: owner names do not
  // identify k0-k9. It remains in the brain for manual recovery.
  if (!robot.brain.data?._private || !Object.hasOwn(robot.brain.data._private, REGISTRY_KEY)) {
    return { version: 2, groups: {} };
  }
  const value = robot.brain.get<unknown>(REGISTRY_KEY);
  if (isRegistry(value)) return value;
  if (isLegacyRegistry(value)) return migrateRegistry(robot, value);
  throw new Error("Invalid key-holder registry; refusing to overwrite it");
}

function cleanCommandValue(input: string): string {
  return input.trim().replace(/[?.!]+\s*$/, "").trim();
}

function reportInvalidNumberedKey(msg: Response, input: string): boolean {
  const key = cleanCommandValue(input).toLowerCase();
  if (!NUMBERED_KEY_LIKE.test(key) || NUMBERED_KEY.test(key)) return false;
  msg.send(`Invalid key "${key}". Use k0 through k9 for numbered keys, or kx when the key number is unknown.`);
  return true;
}

function holderId(user: User): string {
  return user.id || `name:${user.name.toLowerCase()}`;
}

function holderName(robot: Robot, holder: KeyHolder): string {
  return robot.brain.data?.users?.[holder.id]?.name || holder.name;
}

function groupLabel(group: string): string {
  return group === "k0" ? "k0 (master key)" : group;
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
  const name = cleanCommandValue(input).replace(/^@/, "").toLowerCase();
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
  const name = cleanCommandValue(input);
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

  const remove = (msg: Response, group: string, holder: User = msg.message.user): void => {
    const state = registry(robot);
    const removed = removeHolder(state, group, holder);
    if (removed) save(state);
    msg.send(removed
      ? `Okay, ${holder.name} no longer holds ${groupLabel(group)}.`
      : `I have no record of ${holder.name} holding ${groupLabel(group)}.`);
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

  robot.respond(/who(?: all)? (?:has|have) (?:the )?(k(?:[0-9]|x))(?: keys?)?\s*[?.!]*\s*$/i, (msg) => {
    msg.send(describeGroup(robot, registry(robot), msg.match[1].toLowerCase()));
  });

  robot.respond(/who(?: all)? (?:has|have) unknown keys?\s*[?.!]*\s*$/i, (msg) => {
    // Keep the former wording as an input alias while always storing and
    // displaying the group as kx.
    msg.send(describeGroup(robot, registry(robot), UNKNOWN));
  });

  robot.respond(/who(?: all)? (?:has|have) (?:(?:the|a) )?keys?\s*[?.!]*\s*$/i, (msg) => {
    const state = registry(robot);
    const groups = Object.keys(state.groups)
      .filter((group) => group !== UNKNOWN)
      .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
    if (state.groups[UNKNOWN]?.length) groups.push(UNKNOWN);
    msg.send(groups.length
      ? groups.map((group) => describeGroup(robot, state, group)).join("\n")
      : EMPTY_MESSAGE);
  });

  robot.respond(/who(?: all)? (?:has|have) (.+)'s keys?\s*[?.!]*\s*$/i, (msg) => {
    msg.send(`Keys are identified as k0 through k9, with kx for an unknown number. Use "bot who has kN" instead of ${msg.match[1]}'s name.`);
  });

  robot.respond(/i (?:don'?t|do not) (?:has|have) (?:the )?(k(?:[0-9]|x))(?: keys?)?\s*[?.!]*\s*$/i, (msg) => {
    remove(msg, msg.match[1].toLowerCase());
  });

  robot.respond(/i (?:don'?t|do not) (?:has|have) unknown keys?\s*[?.!]*\s*$/i, (msg) => {
    remove(msg, UNKNOWN);
  });

  robot.respond(/i (?:don'?t|do not) (?:has|have) (?:(?:the|a) )?keys?\s*[?.!]*\s*$/i, (msg) => {
    const state = registry(robot);
    const removed = Object.keys(state.groups).filter((group) => removeHolder(state, group, msg.message.user));
    if (removed.length) save(state);
    const legacyRemoved = removeLegacyAssignments(robot, msg.message.user);
    msg.send(removed.length || legacyRemoved
      ? `Okay, ${msg.message.user.name} no longer holds any recorded keys.`
      : "Yes, I know buddy");
  });

  robot.respond(/i (?:have given|gave|had given) (?:the )?(k(?:[0-9]|x))(?: keys?)? to (.+?)\s*[?.!]*\s*$/i, (msg) => {
    transfer(msg, msg.match[2], msg.match[1].toLowerCase());
  });

  robot.respond(/i (?:have given|gave|had given) unknown keys? to (.+?)\s*[?.!]*\s*$/i, (msg) => {
    transfer(msg, msg.match[1], UNKNOWN);
  });

  robot.respond(/i (?:have given|gave|had given) (?:(?:the|a) )?keys? to (.+?)\s*[?.!]*\s*$/i, (msg) => {
    transfer(msg, msg.match[1]);
  });

  robot.respond(/^(?!(?:who(?: all)?|i\s+(?:don'?t|do not))\s)(?!.*\s+(?:doesn'?t|does not)\s+have\s+k(?:\d+|x)(?:\s+keys?)?\s*[?.!]*\s*$)(\S.*?)\s+(?:has|have)\s+(?:the\s+)?(k(?:[0-9]|x))(?:\s+keys?)?\s*[?.!]*\s*$/i, (msg) => {
    assign(msg, msg.match[1], msg.match[2].toLowerCase());
  });

  robot.respond(/^(?!(?:who(?: all)?|i\s+(?:don'?t|do not))\s)(?!.*\s+(?:doesn'?t|does not)\s+have\s+k(?:\d+|x)(?:\s+keys?)?\s*[?.!]*\s*$)(\S.*?)\s+(?:has|have)\s+unknown keys?\s*[?.!]*\s*$/i, (msg) => {
    assign(msg, msg.match[1], UNKNOWN);
  });

  robot.respond(/^(?!(?:who(?: all)?|i\s+(?:don'?t|do not))\s)(\S.*?)\s+(?:doesn'?t|does not)\s+have\s+(k(?:\d+|x))(?:\s+keys?)?\s*[?.!]*\s*$/i, (msg) => {
    if (reportInvalidNumberedKey(msg, msg.match[2])) return;
    const holder = resolveHolder(robot, msg, msg.match[1]);
    if (holder) remove(msg, msg.match[2].toLowerCase(), holder);
  });

  // Invalid numeric keys are matched explicitly so they receive an actionable
  // response rather than falling through to the unnumbered kx group.
  robot.respond(/who(?: all)? (?:has|have) (?:the )?(k\d+)(?: keys?)?\s*[?.!]*\s*$/i, (msg) => {
    reportInvalidNumberedKey(msg, msg.match[1]);
  });
  robot.respond(/i (?:don'?t|do not) (?:has|have) (?:the )?(k\d+)(?: keys?)?\s*[?.!]*\s*$/i, (msg) => {
    reportInvalidNumberedKey(msg, msg.match[1]);
  });
  robot.respond(/i (?:have given|gave|had given) (?:the )?(k\d+)(?: keys?)? to (.+?)\s*[?.!]*\s*$/i, (msg) => {
    reportInvalidNumberedKey(msg, msg.match[1]);
  });
  robot.respond(/^(?!(?:who(?: all)?|i\s+(?:don'?t|do not))\s)(?!.*\s+(?:doesn'?t|does not)\s+have\s+k(?:\d+|x)(?:\s+keys?)?\s*[?.!]*\s*$)(\S.*?)\s+(?:has|have)\s+(?:the\s+)?(k\d+)(?:\s+keys?)?\s*[?.!]*\s*$/i, (msg) => {
    reportInvalidNumberedKey(msg, msg.match[2]);
  });

  robot.respond(/^(?!(?:who(?: all)?|i\s+(?:don'?t|do not))\s)(?!.*\s+(?:doesn'?t|does not)\s+have\s+k(?:\d+|x)(?:\s+keys?)?\s*[?.!]*\s*$)(\S.*?)\s+(?:has|have)\s+(?:(?:the|a)\s+)?keys?(?:\s+of\s+(.+?))?\s*[?.!]*\s*$/i, (msg) => {
    const hint = cleanCommandValue(msg.match[2] ?? "");
    if (hint && reportInvalidNumberedKey(msg, hint)) return;
    // Unspecified and legacy owner-based forms remain in the kx group; they
    // never guess or assign a numbered key.
    const group = hint && (isSupportedGroup(hint.toLowerCase()) || hint.toLowerCase() === LEGACY_UNKNOWN)
      ? (hint.toLowerCase() === LEGACY_UNKNOWN ? UNKNOWN : hint.toLowerCase())
      : UNKNOWN;
    assign(msg, msg.match[1], group);
  });
};

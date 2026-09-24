// Description:
//   Script for maininting scores of different users.
//
// Commands:
//   @name++ or @name-- : Adds/subtracts 1 point to/from a mentioned user's score
//   hubot score name or hubot score @name : Shows a user's score by exact or unique partial name

import type { Robot, Response } from "./runtime/types";
import { scoreNameForQuery } from "./runtime/score-user";

import { info } from "./util";

const responses = [
  "Flamboyant!",
  "Baroque!",
  "Impressive!",
  "Lustrous!",
  "Splashy!",
  "Superb!",
  "Splendid!",
];

interface ScoreResult {
  New: number;
  Name: string;
  Response: string;
}

function parse(json: string): string[][] {
  const result: string[][] = [];
  for (const line of json.toString().split("\n")) {
    result.push(line.split(",").map((s) => s.trim()));
  }
  // Same `if result != "" then result else false` dead-branch pattern as
  // info.ts/birthday.ts/batch-score.ts/httpd.ts — always returns the array,
  // never `false`. Preserved exactly.
  return result;
}

export = (robot: Robot): void => {
  const getChannel = (response: Response): string => {
    if (response.message.room === response.message.user.name) {
      return `@${response.message.room}`;
    } else {
      const isDM = response.message.room[0] === "D";
      const messageType = isDM ? "DM" : "unknown";
      return `#${messageType}`;
    }
  };

  robot.listenerMiddleware((context, next, done) => {
    try {
      // Check if it was called in a room.
      if (getChannel(context.response) === "#DM") {
        context.response.reply("This won't work here");
        // Skipping sending the message to general channel.
        // robot.send room: 'general', "@#{context.response.message.user.name} pls dont DM me. Talk here in public!"
        // Bypass executing the listener callback
        done();
      } else {
        next(done);
      }
    } catch (err) {
      robot.emit("error", err, context.response);
    }
  });

  // returns list of skipped words
  const skippedlist = (): string[] => {
    const list = robot.brain.get("skippedlist") || [];
    robot.brain.set("skippedlist", list);
    return list;
  };

  // return object to store data for all keywords
  // using this, stores the data in brain's "scorefield" key
  const scorefield = (): { [name: string]: number } => {
    const field = robot.brain.get("scorefield") || {};
    robot.brain.set("scorefield", field);
    return field;
  };

  const detailedfield = (): {
    [name: string]: {
      plus?: { [k: string]: number };
      minus?: { [k: string]: number };
    };
  } => {
    const field = robot.brain.get("detailedfield") || {};
    robot.brain.set("detailedfield", field);
    return field;
  };

  // returns last score
  const lastScore = (
    name: string,
    field: { [name: string]: number },
  ): number => {
    name = name.toLowerCase();
    return field[name] || 0;
  };

  // returns depreciation field associated to a single user
  const userFieldMinus = (user: string): { [k: string]: number } => {
    const Detailedfield = detailedfield();
    Detailedfield[user] = Detailedfield[user] || {};
    Detailedfield[user]["minus"] = Detailedfield[user]["minus"] || {};
    return Detailedfield[user]["minus"] as { [k: string]: number };
  };

  // returns appreciation field associated to a single user
  const userFieldPlus = (user: string): { [k: string]: number } => {
    const Detailedfield = detailedfield();
    Detailedfield[user] = Detailedfield[user] || {};
    Detailedfield[user]["plus"] = Detailedfield[user]["plus"] || {};
    return Detailedfield[user]["plus"] as { [k: string]: number };
  };

  // updates detailed field
  const updateDetailedScore = (
    field: { [k: string]: number },
    sendername: string,
    fieldtype: string,
  ): void => {
    if (fieldtype === "plus") {
      field[sendername] = field[sendername] + 1 || 1;
    } else {
      // The detailed map stores occurrence counts. detailed-score.ts turns
      // depreciation counts into negative chart values when rendering.
      field[sendername] = field[sendername] + 1 || 1;
    }
  };

  // updates score according to ++/--
  const updateScore = (
    word: string,
    field: { [name: string]: number },
    username: string,
    slackIds: string[],
  ): ScoreResult => {
    const posRegex = /\+\+/;
    const negRegex = /\-\-/;
    let name = "";
    let response = "";

    // if there is to be `plus` in score
    if (word.indexOf("++") >= 0) {
      name = word.replace(posRegex, "");
      if (username.toLowerCase() === name.toLowerCase()) {
        response = "-1";
      } else if (slackIds.includes(name)) {
        field[name.toLowerCase()] = lastScore(name, field) + 1;
        const userfield = userFieldPlus(name.toLowerCase());
        updateDetailedScore(userfield, username, "plus");
        response = responses[Math.floor(Math.random() * responses.length)];
      } else {
        response = "0";
      }

      // if there is to be `minus` in score
    } else if (word.indexOf("--") >= 0) {
      name = word.replace(negRegex, "");
      if (username.toLowerCase() === name.toLowerCase()) {
        response = "-1";
      } else if (slackIds.includes(name)) {
        field[name.toLowerCase()] = lastScore(name, field) - 1;
        const userfield = userFieldMinus(name.toLowerCase());
        updateDetailedScore(userfield, username, "minus");
        response = "Ouch!";
      } else {
        response = "0";
      }
    }

    const newscore = field[name.toLowerCase()];

    // returns 'name' and 'newscore' and 'response'
    return { New: newscore, Name: name, Response: response };
  };

  let cachedMembers: { ids: string[]; fetchedAt: number } | undefined;
  let pendingMembers: Promise<string[] | null> | undefined;
  const getSlackIds = (): Promise<string[] | null> => {
    const now = Date.now();
    if (cachedMembers && now - cachedMembers.fetchedAt < 60_000) {
      return Promise.resolve(cachedMembers.ids);
    }
    if (pendingMembers) return pendingMembers;
    pendingMembers = new Promise<string[] | null>((resolve) => {
      info((err, body) => {
        if (err || body == null) {
          robot.logger.warning(`leaderboard: could not fetch slack ids: ${err}`);
          resolve(null);
          return;
        }
        const ids = parse(body)
          .filter((user) => user.length >= 13 && user[10])
          .map((user) => user[10]);
        if (ids.length === 0) {
          robot.logger.warning("leaderboard: member spreadsheet contained no Slack users");
          resolve(null);
          return;
        }
        resolve(ids);
      });
    }).then((ids) => {
      if (ids) {
        cachedMembers = { ids, fetchedAt: Date.now() };
        return ids;
      }
      // A brief sheet outage should not interrupt scores immediately after a
      // successful read, but stale membership must not be trusted forever.
      return cachedMembers && Date.now() - cachedMembers.fetchedAt < 300_000
        ? cachedMembers.ids : null;
    }).finally(() => { pendingMembers = undefined; });
    return pendingMembers;
  };

  // A selected Slack mention appears as <@U...> in the signed raw event, but
  // can normalize to a display name with spaces. Parse the raw event so the
  // score target is the actual member, not a fragment of their display name.
  robot.hear(/\+\+|--/g, async (msg) => {
    const raw = msg.message.rawSlackText ?? msg.message.text ?? "";
    const mentions = [...raw.matchAll(/<@([UW][A-Z0-9]+)(?:\|[^>]*)?>(\+\+|--)|(^|[^\w<])@([a-z0-9._-]+)(\+\+|--)/gim)];
    if (mentions.length === 0) return;

    const ScoreField = scorefield();
    const SkippedList = skippedlist();
    const slackIds = await getSlackIds();
    if (!slackIds) {
      msg.send("Could not update scores because the member list is unavailable.");
      return;
    }
    const replies: string[] = [];
    for (const mention of mentions) {
      const id = mention[1];
      const typedName = mention[4]?.toLowerCase();
      const operation = mention[2] ?? mention[5];
      const user = id
        ? robot.brain.data.users[id]
        : Object.values(robot.brain.data.users).find((candidate) =>
            candidate.name?.toLowerCase() === typedName,
          );
      const name = user?.name?.toLowerCase();
      if (!user || !name) {
        replies.push(`${typedName ?? id}? Never heard of 'em`);
        continue;
      }
      if (SkippedList.includes(name) || name.length + 2 > 30) continue;
      const allowed = slackIds.some((member) =>
        member.toLowerCase() === name || member.toLowerCase() === user.id.toLowerCase(),
      );
      const result = updateScore(
        `${name}${operation}`, ScoreField, msg.message.user.name,
        allowed ? [name] : [],
      );
      if (result.Response === "-1") {
        replies.push(`${name}${operation} [Sorry, You can't give ++ or -- to yourself.]`);
      } else if (result.Response === "0") {
        replies.push(`${name}? Never heard of 'em`);
      } else {
        replies.push(`${name}${operation} [${result.Response} You're now at ${result.New}]`);
      }
    }
    if (replies.length) msg.send(`${replies.join("\n")}\n`);
  });

  // response for score status of any <keyword>
  robot.respond(/score (.+)$/i, (msg) => {
    // we do not want to reply in case of batch score is requested
    if (/^f\d\d(?:\s+-[bp])?$/i.test(msg.match[1].trim())) {
      return;
    }

    // data-store object
    const ScoreField = scorefield();

    // <keyword> whose score is to be shown
    const name = scoreNameForQuery(robot, msg, msg.match[1]);

    // If the key exist
    if (ScoreField[name] !== undefined) {
      // current score for keyword
      const currentscore = ScoreField[name];
      msg.send(`${name} : ${currentscore}`);
    } else {
      // Scores are stored under Slack usernames. Keep exact usernames and
      // real/display names ahead of partial matches to avoid changing them.
      const users = Object.values(robot.brain.data.users);
      if (name && !users.some((user) => typeof user.name === "string" && user.name.toLowerCase() === name)) {
        const exactAliases = users.filter((user) => typeof user.name === "string" &&
          [user.real_name, user.display_name].some(
            (candidate) => typeof candidate === "string" && candidate.trim().toLowerCase() === name,
          ));
        const candidates = exactAliases.length ? exactAliases : users.filter((user) =>
          typeof user.name === "string" && [user.name, user.real_name, user.display_name].some(
            (candidate) => typeof candidate === "string" && candidate.toLowerCase().includes(name),
          ));
        const matches = [...new Set(candidates.map((user) => user.name.toLowerCase()))];
        if (matches.length > 1) {
          msg.send(`Be more specific, I know ${matches.length} people named like that: ${matches.join(", ")}`);
          return;
        }
        if (matches.length === 1 && ScoreField[matches[0]] !== undefined) {
          msg.send(`${matches[0]} : ${ScoreField[matches[0]]}`);
          return;
        }
      }
      msg.send(`${name}? Never heard of 'em`);
    }
  });

  robot.on("plusplus", (event: { username: string }) => {
    const ScoreField = scorefield();
    const result = updateScore(
      `${event.username}++`,
      ScoreField,
      "MostWordsBot",
      [event.username],
    );
    const newmsg = `${event.username}++ [${result.Response} You're now at ${result.New}]`;
    robot.send({ room: "general" }, newmsg);
  });
};

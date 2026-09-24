// Description:
//   gets MDG member's info from google doc
//   Type a partial spreadsheet name or an exact Slack username, display, or real name
//
// Configuration:
//   INFO_SPREADSHEET_URL
//
// Commands:
//   hubot info <name> - Get information by partial spreadsheet name or Slack username, display, or real name

import type { Response, Robot, User } from "./runtime/types";

import moment from "moment";
import { info } from "./util";

function parse(json: string, query: string): string[][] | null {
  const result: string[][] = [];
  for (const line of json.toString().split("\n")) {
    const y = line.toLowerCase().indexOf(query);
    if (y !== -1) {
      result.push(line.split(",").map((s) => s.trim()));
    }
  }
  /* BUGFIX: original CoffeeScript ended with a dead `else false` branch
     (`if result != "" then result else false`), so parse() always returned
     the array — even when empty — and the callers' `if (!result)`
     "not found" paths were unreachable. This version returns null when no
     rows match, so those checks actually fire. */
  if (result.length === 0) {
    return null;
  }
  return result;
}

function slackUsersForQuery(robot: Robot, msg: Response, query: string): User[] {
  const name = query.trim().replace(/^@/, "").toLowerCase();
  const selectedId = query.trim().startsWith("@") ? msg.message.slackUserMentions?.[0] : undefined;
  if (selectedId) {
    const selected = robot.brain.data.users[selectedId];
    return selected ? [selected] : [];
  }
  const users = Object.values(robot.brain.data.users);
  const usernames = users.filter((user) => typeof user.name === "string" && user.name.toLowerCase() === name);
  if (usernames.length) return usernames;
  return users.filter((user) => [user.display_name, user.real_name].some(
    (candidate) => typeof candidate === "string" && candidate.trim().toLowerCase() === name,
  ));
}

function parseForSlackUsers(json: string, users: User[]): string[][] | null {
  const identifiers = new Set(users.flatMap((user) => [user.id, user.name]
    .filter((value): value is string => typeof value === "string" && value !== "")
    .map((value) => value.toLowerCase())));
  const matches = json.split("\n")
    .map((line) => line.split(",").map((field) => field.trim()))
    .filter((row) => identifiers.has((row[10] || "").toLowerCase()));
  return matches.length ? matches : null;
}

function randomColor(): string {
  return "#" + (0x1000000 + Math.random() * 0xffffff).toString(16).slice(1, 7);
}

export = (robot: Robot): void => {
  robot.respond(/(info) (.+)$/i, (msg) => {
    const query = msg.match[2].toLowerCase();
    info((err, body) => {
      if (err || body == null) {
        msg.send(`Could not fetch member data :( ${err}`);
        return;
      }
      const users = slackUsersForQuery(robot, msg, query);
      const result = (users.length ? parseForSlackUsers(body, users) : null) || parse(body, query);
      if (!result) {
        msg.send("I could not find a user matching `" + query.toString() + "`");
      } else {
        msg.send(
          result.length + " user(s) found matching `" + query.toString() + "`",
        );
        for (const user of result) {
          msg.send({
            attachments: [
              {
                fallback: user.join(" \t "),
                color: randomColor(),
                title: user[0],
                title_link: `https://facebook.com/${user[9]}`,
                text:
                  `Github: <https://github.com/${user[8]}|${user[8]}>` +
                  `\nRoom no: ${user[7]}`,
                fields: [
                  {
                    title: "Mobile",
                    value: `<tel:${user[1]}|${user[1]}>`,
                    short: true,
                  },
                  {
                    title: "Email",
                    value: `<mailto:${user[2]}|${user[2]}>`,
                    short: true,
                  },
                ],
                footer: `${user[4]} ${user[5]} (${user[6]})`,
                ts: moment(user[3], "DD/MM/YYYY").format("X"),
              },
            ],
          });
        }
      }
    });
  });
};

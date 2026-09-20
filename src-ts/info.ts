// Description:
//   gets MDG member's info from google doc
//   Type a partial name to get all matches
//
// Configuration:
//   INFO_SPREADSHEET_URL
//
// Commands:
//   hubot info <partial name> - Get information about a person

import type { Robot } from "./runtime/types";

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
      const result = parse(body, query);
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

// Description:
//   Script for birthdays!.
//
// Configuration:
//   INFO_SPREADSHEET_URL
//
// Commands:
//   hubot birthday <user>

import type { Robot } from "./runtime/types";

import moment from "moment";
import * as cron from "node-cron";
import { info } from "./util";

function parse(json: string, query: string): string[][] | null {
  const result: string[][] = [];
  for (const line of json.toString().split("\n")) {
    const y = line.toLowerCase().indexOf(query);
    if (y !== -1) {
      result.push(line.split(",").map((s) => s.trim()));
    }
  }
  /* BUGFIX: see info.ts — the original CoffeeScript's dead `else false`
     branch meant parse() always returned the array and the callers'
     `if (!result)` checks were unreachable. Returning null on an empty
     match set makes those checks live: the "not found" message and the
     cron job's early-return now actually trigger. */
  if (result.length === 0) {
    return null;
  }
  return result;
}

export = (robot: Robot): void => {
  robot.respond(/(birthday) (.+)$/i, (msg) => {
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
          if (user[3] === "") {
            msg.send(`${user[0]} bro add karde yrr!`);
          } else {
            msg.send(
              `Wish ${user[0]} on ${moment(user[3], "DD/MM/YYYY").format("MMM Do, YYYY")}!`,
            );
          }
        }
      }
    });
  });

  // This will run every day at 00:00:05
  cron.schedule("5 0 0 * * *", () => {
    info((err, body) => {
      if (err || body == null) {
        robot.logger.warning(`birthday: could not fetch member data: ${err}`);
        return;
      }
      const result = parse(body, "/");
      if (!result) {
        return;
      }
      for (const member of result) {
        try {
          const dob = moment(member[3], "DD/MM/YYYY");
          const today = moment();
          if (
            dob.format("D") === today.format("D") &&
            dob.format("M") === today.format("M") &&
            Number(member[6]) > 15000000
          ) {
            robot.send(
              { room: "general" },
              `Happy Birthday ${member[0]}:birthday::birthday:!!`,
            );
          }
        } catch (error) {
          robot.send(
            { room: "general" },
            "Help!! These dates are breaking me!",
          );
        }
      }
    });
  });
};

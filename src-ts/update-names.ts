// Description:
//   Script for updating names database
//
// Commands:
//   hubot update db

import type { Robot } from "./runtime/types";

import * as https from "https";

const token = process.env.SLACK_API_TOKEN;

export = (robot: Robot): void => {
  if (!token) {
    return;
  }

  interface UpdateRun {
    parsedUsers: number;
    updatedUsers: number;
    totalUsers: number;
    room: string;
  }

  const reportIfComplete = (run: UpdateRun): void => {
    if (run.parsedUsers === run.totalUsers) {
      robot.send(
        { room: run.room },
        `Updated names for ${run.updatedUsers} out of ${run.totalUsers} users`,
      );
    }
  };

  const updateName = (uid: string, run: UpdateRun): void => {
    const pre = "/api/users.info?token=";
    const post = "&user=";
    const url = pre + encodeURIComponent(token) + post + encodeURIComponent(uid);
    let output = "";
    let complete = false;
    const completeUser = (): void => {
      if (complete) {
        return;
      }
      complete = true;
      run.parsedUsers++;
      reportIfComplete(run);
    };
    const request = https.get({ host: "slack.com", path: url }, (res) => {
      res.on("data", (chunk) => {
        output += chunk;
      });
      res.on("end", () => {
        try {
          if (res.statusCode != null && res.statusCode >= 400) {
            throw new Error(`Slack returned HTTP ${res.statusCode}`);
          }
          const data = JSON.parse("" + output);
          if (data.ok) {
            const user = robot.brain.userForId(data.user.id);
            if (user.name !== data.user.name) {
              user.name = data.user.name;
              run.updatedUsers++;
            }
          }
        } catch (e) {
          robot.logger.warning(`update-names: bad response for ${uid}: ${e}`);
        }
        completeUser();
      });
      res.on("error", (error) => {
        robot.logger.warning(`update-names: response failed for ${uid}: ${error}`);
        completeUser();
      });
    });
    request.on("error", (error) => {
      robot.logger.warning(`update-names: request failed for ${uid}: ${error}`);
      completeUser();
    });
  };

  robot.respond(/update db/i, (msg) => {
    msg.send("Updating names in database");
    const run: UpdateRun = {
      parsedUsers: 0,
      updatedUsers: 0,
      totalUsers: Object.keys(robot.brain.data.users).length,
      room: msg.message.user.room || msg.message.room,
    };
    if (run.totalUsers === 0) {
      reportIfComplete(run);
      return;
    }
    for (const key of Object.keys(robot.brain.data.users)) {
      updateName(robot.brain.data.users[key].id, run);
    }
  });
};

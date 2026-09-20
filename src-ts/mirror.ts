// Description:
//   cron jobs for managing the MDG Mirror Spreadsheet
//
//   1) Adds new week column in the sheet every Sunday 9 pm.
//   2) Reminds those who have not filled the sheet every Tuesday and Friday at 6 am.

import type { Robot } from "./runtime/types";

import { https } from "follow-redirects";
import * as cron from "node-cron";

export = (robot: Robot): void => {
  const url = process.env.MIRROR_SCRIPT_URL;
  if (url) {
    // This will run every Sunday at 9 pm
    cron.schedule("0 0 21 * * Sunday", () => {
      let output = "";
      const request = https.get(url + "?type=3", (res) => {
        res.on("data", (body) => {
          output += body;
        });
        res.on("end", () => {
          if (res.statusCode != null && res.statusCode >= 400) {
            robot.logger.warning(`mirror: add-week returned HTTP ${res.statusCode}`);
            return;
          }
          robot.send(
            { room: "general" },
            `Added new week to Mdg Mirror. (${output})`,
          );
        });
        res.on("error", (error) => {
          robot.logger.warning(`mirror: add-week response failed: ${error}`);
        });
      });
      request.on("error", (error) => {
        robot.logger.warning(`mirror: add-week request failed: ${error}`);
      });
    });

    // This will run every Tuesday and Friday at 6 am
    cron.schedule("0 0 6 * * Tuesday,Friday", () => {
      let output = "";
      const request = https.get(url + "?type=2", (res) => {
        res.on("data", (body) => {
          output += body;
        });
        res.on("end", () => {
          if (res.statusCode != null && res.statusCode >= 400) {
            robot.logger.warning(`mirror: reminder returned HTTP ${res.statusCode}`);
            return;
          }
          try {
            const namesArray: string[] = JSON.parse(output);
            if (!namesArray.length) {
              return;
            }
            const names = namesArray.map((el) => "@" + el).join(" ");
            robot.send(
              { room: "general" },
              names + "\nPlease fill up the activities sheet.",
            );
          } catch (e) {
            robot.logger.warning(`mirror: bad response: ${e}`);
          }
        });
        res.on("error", (error) => {
          robot.logger.warning(`mirror: reminder response failed: ${error}`);
        });
      });
      request.on("error", (error) => {
        robot.logger.warning(`mirror: reminder request failed: ${error}`);
      });
    });
  }
};

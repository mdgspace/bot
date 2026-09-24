// Description:
// Returns the number of likes on MDG page on FB
//
// Dependencies:
//   None
//
// Configuration:
//   FB_APP_ACCESS_TOKEN
//
// Commands:
//   hubot fb likes

import type { Robot } from "./runtime/types";

import * as https from "https";

interface FbPageLikes {
  fan_count?: number;
}

export = (robot: Robot): void => {
  robot.respond(/fb(\s*)likes/i, (msg) => {
    const token = process.env.FB_APP_ACCESS_TOKEN;
    if (!token) {
      msg.send("Looks like `FB_APP_ACCESS_TOKEN` is missing :thinking_face:");
      return;
    }
    const request = https.get(
      {
        host: "graph.facebook.com",
        path: `/mdgiitr?access_token=${encodeURIComponent(token)}&fields=fan_count`,
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk.toString();
        });
        res.on("end", () => {
          if (res.statusCode != null && res.statusCode >= 400) {
            robot.logger.warning(`fblikes: HTTP ${res.statusCode}`);
            msg.send("I couldn't fetch Facebook likes right now.");
            return;
          }
          try {
            const parsed: FbPageLikes = JSON.parse(data);
            if (parsed.fan_count == null) {
              throw new Error("fan_count is missing");
            }
            msg.send(String(parsed.fan_count));
          } catch (e) {
            robot.logger.warning(`fblikes: bad response: ${e}`);
            msg.send("I couldn't fetch Facebook likes right now.");
          }
        });
        res.on("error", (error) => {
          robot.logger.warning(`fblikes: response failed: ${error}`);
        });
      },
    );
    request.on("error", (error) => {
      robot.logger.warning(`fblikes: request failed: ${error}`);
      msg.send("I couldn't fetch Facebook likes right now.");
    });
  });
};

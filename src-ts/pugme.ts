// Description:
//   Pugme is the most important thing in life
//
// Dependencies:
//   None
//
// Configuration:
//   None
//
// Commands:
//   hubot pug me - Receive a pug
//   hubot pug bomb N - get N pugs

import type { Robot } from "./runtime/types";

export = (robot: Robot): void => {
  robot.respond(/pug me/i, (msg) => {
    msg.http("http://pugme.herokuapp.com/random").get()((err, res, body) => {
      if (err || body == null) {
        robot.logger.warning(`pugme: request failed: ${err || "empty response"}`);
        msg.send("I couldn't fetch a pug right now.");
        return;
      }
      try {
        msg.send(JSON.parse(body).pug);
      } catch (e) {
        robot.logger.warning(`pugme: bad response: ${e}`);
      }
    });
  });

  robot.respond(/pug bomb( (\d+))?/i, (msg) => {
    const count = msg.match[2] || 5;
    msg.http("http://pugme.herokuapp.com/bomb?count=" + count).get()(
      (err, res, body) => {
        if (err || body == null) {
          robot.logger.warning(`pugme: request failed: ${err || "empty response"}`);
          msg.send("I couldn't fetch pugs right now.");
          return;
        }
        try {
          for (const pug of JSON.parse(body).pugs) {
            msg.send(pug);
          }
        } catch (e) {
          robot.logger.warning(`pugme: bad response: ${e}`);
        }
      },
    );
  });

  robot.respond(/how many pugs are there/i, (msg) => {
    msg.http("http://pugme.herokuapp.com/count").get()((err, res, body) => {
      if (err || body == null) {
        robot.logger.warning(`pugme: request failed: ${err || "empty response"}`);
        msg.send("I couldn't fetch the pug count right now.");
        return;
      }
      try {
        msg.send(`There are ${JSON.parse(body).pug_count} pugs.`);
      } catch (e) {
        robot.logger.warning(`pugme: bad response: ${e}`);
      }
    });
  });
};

// Description:
//   Inspect the data in redis easily
//
// Commands:
//   hubot show users - Display all users that hubot knows about
//   hubot show storage - Display the contents that are persisted in the brain

import type { Robot } from "./runtime/types";
import * as Util from "util";

export = (robot: Robot): void => {
  robot.respond(/show storage$/i, (msg) => {
    const output = Util.inspect(robot.brain.data, false, 4);
    msg.send(output);
  });

  robot.respond(/show users$/i, (msg) => {
    let response = "";

    for (const key of Object.keys(robot.brain.data.users)) {
      const user = robot.brain.data.users[key];
      response += `${user.id} ${user.name}`;
      if (user.email_address) {
        response += ` <${user.email_address}>`;
      }
      response += "\n";
    }

    msg.send(response);
  });
};

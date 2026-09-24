// Description:
//   Inspect the data in redis easily
//
// Commands:
//   hubot show users - Display all users that hubot knows about
//   hubot show storage - Display the contents that are persisted in the brain

import type { Robot } from "./runtime/types";
import * as Util from "util";
import { adminGuard, redactStorage } from "./runtime/admin";

export = (robot: Robot): void => {
  const allowed = adminGuard();
  robot.respond(/show storage$/i, (msg) => {
    if (!allowed(msg)) return;
    const output = Util.inspect(redactStorage(robot.brain.data), false, 4);
    msg.send(output);
  });

  robot.respond(/show users$/i, (msg) => {
    if (!allowed(msg)) return;
    let response = "";

    for (const key of Object.keys(robot.brain.data.users)) {
      const user = robot.brain.data.users[key];
      response += `${user.id} ${user.name}`;
      response += "\n";
    }

    msg.send(response);
  });
};

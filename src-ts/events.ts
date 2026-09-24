// Description:
//   Event system related utilities
//
// Commands:
//   hubot fake event <event> - Triggers the <event> event for debugging reasons
//
// Events:
//   debug - {user: <user object to send message to>}

import type { Robot, User } from "./runtime/types";
import { adminGuard } from "./runtime/admin";
import * as util from "util";

export = (robot: Robot): void => {
  const allowed = adminGuard();
  robot.respond(/FAKE EVENT (.*)/i, (msg) => {
    if (!allowed(msg)) return;
    msg.send(`fake event '${msg.match[1]}' triggered`);
    robot.emit(msg.match[1], { user: msg.message.user });
  });

  robot.on("debug", (event: { user: User }) => {
    robot.send(event.user, util.inspect(event));
  });
};

// Description:
//   Utility commands surrounding Hubot uptime.
//
// Commands:
//   hubot ping - Reply with pong
//   hubot echo <text> - Reply back with <text>
//   hubot time - Reply with current time
//   hubot die - End hubot process

import type { Robot } from "./runtime/types";
import { adminGuard } from "./runtime/admin";

export = (robot: Robot): void => {
  const allowed = adminGuard();
  robot.respond(/PING$/i, (msg) => {
    msg.send("PONG");
  });

  robot.respond(/ADAPTER$/i, (msg) => {
    msg.send(robot.adapterName);
  });

  robot.respond(/ECHO (.*)$/i, (msg) => {
    msg.send(msg.match[1]);
  });

  robot.respond(/TIME$/i, (msg) => {
    msg.send(`Server time is: ${new Date()}`);
  });

  robot.respond(/DIE$/i, (msg) => {
    if (!allowed(msg)) return;
    msg.send("Goodbye, cruel world.");
    robot.emit("shutdown");
  });
};

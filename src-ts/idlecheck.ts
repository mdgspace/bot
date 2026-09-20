// Description:
// Checks if there are no messages for a fixed time and sends random posts from ToDJ.
//
// Dependencies:
//   None
//
// Configuration:
//   IDLE_TIME_DURATION_HOURS
//
// Commands:
//   None

import type { Robot } from "./runtime/types";

const setTime = parseFloat(process.env.IDLE_TIME_DURATION_HOURS || "0");
let i: ReturnType<typeof setInterval> | undefined;
const msecPerHour = 1000 * 60 * 60;
let lastMsgTime: Date | null = null;
// Preserved from the original — defined but never referenced there either.
const idleMsgs = [
  "Why so silent?",
  "Is anyone alive :expressionless:",
  "Looks like I am all alone!",
];

export = (robot: Robot): void => {
  const checkAndSendMsg = (): void => {
    if (lastMsgTime === null) {
      // Interval only fires after the first `hear` armed it; guard anyway.
      return;
    }
    const idleTimeHour =
      (new Date().getTime() - lastMsgTime.getTime()) / msecPerHour;
    if (idleTimeHour > setTime) {
      robot.emit("send:fb-feed", "dardanaak");
    }
  };

  if (setTime > 0) {
    robot.hear(/.+/i, (msg) => {
      lastMsgTime = new Date();
      if (i !== undefined) {
        clearInterval(i);
      }
      i = setInterval(() => {
        checkAndSendMsg();
      }, msecPerHour * setTime);
    });
  }
};

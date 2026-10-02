// Description:
//   To tell bot if the lab is open or closed.
//
// Commands:
//   bot is lab open/close
//   bot lab is open/close

import type { Robot } from "./runtime/types";
import * as cron from "node-cron";

const istTime = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Kolkata",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export = (robot: Robot, now: () => Date = () => new Date()): void => {
  let status = "";
  let lastAutoCloseDate = "";

  // node-cron 1.x uses the host timezone, so check the Kolkata wall clock
  // explicitly instead of relying on the deployment's TZ setting.
  cron.schedule("* * * * *", () => {
    const parts = Object.fromEntries(
      istTime.formatToParts(now()).map(({ type, value }) => [type, value]),
    );
    const date = `${parts.year}-${parts.month}-${parts.day}`;
    if (
      parts.hour !== "02" ||
      parts.minute !== "00" ||
      date === lastAutoCloseDate
    )
      return;

    lastAutoCloseDate = date;
    status = "closed";
    robot.send(
      { room: "bottesting" },
      "Lab is now closed (auto-updated at 2:00 AM IST).",
    );
  });

  robot.hear(/lab is (open|closed|close)/i, (msg) => {
    status = msg.match[1];
    msg.send(`Okay lab is ${status}`);
  });

  robot.hear(/(is|was) (lab|labs) (open|close|closed)/i, (msg) => {
    if (status.length > 0) {
      msg.send(`lab is ${status}`);
    } else {
      msg.send(
        "Ah! Nobody informed me about the lab status. Don't hold me responsible for this :expressionless:",
      );
    }
  });
};

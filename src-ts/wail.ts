// Description:
//   Returns the names of people in lab
//
// Dependencies:
//   None
//
// Configuration:
//   WAIL_PIC_URL
//
// Commands:
//   hubot who all in lab

import type { Robot } from "./runtime/types";

export = (robot: Robot): void => {
  robot.respond(/who.*lab/i, (msg) => {
    const baseUrl = process.env.WAIL_PIC_URL;
    if (!baseUrl) {
      msg.send("WAIL_PIC_URL is not configured.");
      return;
    }
    const wailUrl = `${baseUrl}?t=${new Date().getTime()}`;
    msg.send({
      attachments: [
        {
          fallback: `Here's a pic: ${wailUrl}`,
          color: "#36a64f",
          pretext: "Here's a pic:",
          image_url: wailUrl,
          ts: new Date().getTime() / 1000,
        },
      ],
    });
  });
};

// Description:
//   Generates help commands for Hubot.
//
// Commands:
//   hubot help - Displays all of the help commands that Hubot knows about.
//   hubot help <query> - Displays all help commands that match <query>.
//
// URLS:
//   /hubot/help
//
// Notes:
//   These commands are grabbed from comment blocks at the top of each file.

import type { Robot } from "./runtime/types";

function helpContents(name: string, commands: string): string {
  return `
<!DOCTYPE html>
<html>
  <head>
  <meta charset="utf-8">
  <title>${name} Help</title>
  <style type="text/css">
    body {
      background: #d3d6d9;
      color: #636c75;
      text-shadow: 0 1px 1px rgba(255, 255, 255, .5);
      font-family: Helvetica, Arial, sans-serif;
    }
    h1 {
      margin: 8px 0;
      padding: 0;
    }
    .commands {
      font-size: 13px;
    }
    p {
      border-bottom: 1px solid #eee;
      margin: 6px 0 0 0;
      padding-bottom: 5px;
    }
    p:last-child {
      border: 0;
    }
  </style>
  </head>
  <body>
    <h1>${name} Help</h1>
    <div class="commands">
      ${commands}
    </div>
  </body>
</html>
  `;
}

export = (robot: Robot): void => {
  robot.respond(/help\s*(.*)?$/i, (msg) => {
    let cmds = robot.helpCommands();
    const filter = msg.match[1];

    if (filter) {
      const normalizedFilter = filter.toLowerCase();
      cmds = cmds.filter((cmd) =>
        cmd.toLowerCase().includes(normalizedFilter),
      );
      if (cmds.length === 0) {
        msg.send(`No available commands match ${filter}`);
        return;
      }
    }

    const prefix = robot.alias || robot.name;
    cmds = cmds.map((cmd) => {
      const replaced = cmd.replace(/hubot/gi, robot.name);
      return replaced.startsWith(robot.name)
        ? prefix + replaced.slice(robot.name.length)
        : replaced;
    });

    const emit = cmds.join("\n");

    msg.send(emit);
  });

  robot.router.get(`/${robot.name}/help`, (req, res) => {
    const cmds = robot
      .helpCommands()
      .map((cmd) =>
        cmd.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"),
      );

    let emit = `<p>${cmds.join("</p><p>")}</p>`;

    emit = emit.replace(/hubot/gi, `<b>${robot.name}</b>`);

    res.setHeader("content-type", "text/html");
    res.end(helpContents(robot.name, emit));
  });
};

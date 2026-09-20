// Description:
//   Simple toss and roll a dice script
//
// Commands:
//   hubot toss
//   hubot roll dice
//   hubot roll n dices

import type { Robot } from "./runtime/types";

export = (robot: Robot): void => {
  const toss = [":head:\nHeads", ":tail:\nTails"];
  const dice = [":one:", ":two:", ":three:", ":four:", ":five:", ":six:"];

  robot.respond(/toss$/i, (msg) => {
    msg.send(msg.random(toss));
  });

  robot.respond(/roll( \d)?( a)? dices?$/i, (msg) => {
    let i = 1;
    const numbers: string[] = [];
    if (msg.match[1]) {
      i = parseInt(msg.match[1].trim(), 10);
    }
    while (i > 0) {
      numbers.push(dice[Math.floor(Math.random() * 6)]);
      i--;
    }
    msg.send(numbers.join(" "));
  });
};

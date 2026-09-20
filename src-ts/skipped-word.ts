// Description:
//   Script to maintain a list of words to be skipped
//   during the execution of some commands.
//
// Commands:
//   hubot skip word
//   hubot unskip word
//   hubot show skipped

import type { Robot } from "./runtime/types";

export = (robot: Robot): void => {
  // returns list of skipped words
  const skippedlist = (): string[] => {
    const list = robot.brain.get("skippedlist") || [];
    robot.brain.set("skippedlist", list);
    return list;
  };

  robot.respond(/skip ([\w\-_]+)/i, (msg) => {
    const skippedList = skippedlist();

    const word = msg.match[1];
    // check if that word already skipped
    if (skippedList.includes(word)) {
      msg.send(`${word} is already skipped`);
    } else {
      skippedList.push(word);
      msg.send(`${word} is skipped`);
    }
  });

  robot.respond(/unskip ([\w\-_]+)/i, (msg) => {
    const skippedList = skippedlist();

    const word = msg.match[1];
    // check if the word is skipped or not
    if (skippedList.includes(word)) {
      skippedList.splice(skippedList.indexOf(word), 1);
      msg.send(`${word} is unskipped`);
    } else {
      msg.send(`${word} is never skipped`);
    }
  });

  robot.respond(/show skipped/i, (msg) => {
    const skippedList = skippedlist();

    // return the words if the list is not empty
    if (skippedList.length) {
      msg.send(`${skippedList.join(", ")}`);
    } else {
      msg.send("Nothing is skipped!!");
    }
  });
};

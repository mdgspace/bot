// Description:
//   Listen all the words spoken by a user.
//   Builds a dictionary of words along with the number of times it was spoken.
//   Display the words spoken by a particular user in desc order.
//   Show message stats
//
// Dependencies:
//   natural - https://www.npmjs.com/package/natural
//
// Configuration:
//   None
//
// Commands:
//   bot show me words spoken by me
//   bot stats
//

import type { Robot } from "./runtime/types";

import * as cron from "node-cron";
import { WordTokenizer } from "natural/lib/natural/tokenizers/regexp_tokenizer";
import { graph } from "./util";

const tokenizer = new WordTokenizer();

const responses = [
  "Looks like you are more of a silent man",
  "There ain't anything for you!",
  "Be more active next time!",
];

function listOfUsersWithCount(robot: Robot): [string, number][] {
  const sorted: [string, number][] = [];
  for (const key of Object.keys(robot.brain.data.users)) {
    const user = robot.brain.data.users[key];
    if ((user.msgcount ?? 0) > 0) {
      sorted.push([user.name, user.msgcount ?? 0]);
    }
  }
  if (sorted.length) {
    sorted.sort((a, b) => b[1] - a[1]);
  }
  return sorted;
}

export = (robot: Robot): void => {
  robot.hear(/^(.+)/i, (msg) => {
    if (msg.match[0].toLowerCase().startsWith(robot.name.toLowerCase())) {
      return;
    }
    const regex = /:([^ :]+):/g;
    msg.match[0] = msg.match[0].replace(regex, "");
    let words: string[] = tokenizer.tokenize(msg.match[0]);
    const pronouns = [
      "i",
      "he",
      "she",
      "it",
      "we",
      "me",
      "mine",
      "his",
      "her",
      "something",
      "they",
      "their",
      "our",
      "those",
      "this",
      "that",
      "these",
      "anything",
      "anybody",
      "anyone",
      "everyone",
      "each",
      "either",
      "everybody",
      "none",
      "everything",
      "neither",
      "nobody",
      "nothing",
      "one",
      "somebody",
      "someone",
    ];

    const conjunctions = ["and", "yet", "but", "for", "so", "or", "nor"];

    const otherWords = ["a", "at", "in", "for", "is", "am", "are"];

    const excluded = otherWords.concat(pronouns, conjunctions);
    words = words.filter((val) => !excluded.includes(val.toLowerCase()));
    if (words.length > 0) {
      const name = msg.message.user.name;
      const user = robot.brain.userForName(name);
      if (user) {
        user.msgcount = (user.msgcount ?? 0) + 1;
        user.words = user.words || {};
        if (Object.keys(user.words).length > 25) {
          let removalCount = 0;
          let i = 0;
          while (removalCount === 0) {
            i++;
            for (const word of Object.keys(user.words)) {
              const spokenCount = user.words[word] ?? 0;
              if (spokenCount <= i) {
                delete user.words[word];
                removalCount++;
              }
            }
          }
        }
        for (const word of words) {
          user.words[word] = ++user.words[word] || 1;
        }
      }
    }
  });

  robot.respond(/.*show.*words.*/i, (msg) => {
    const name = msg.message.user.name;
    const user = robot.brain.userForName(name);
    if (user) {
      const sorted: [string, number][] = [];
      user.words = user.words || {};
      for (const word of Object.keys(user.words)) {
        sorted.push([word, user.words[word] ?? 0]);
      }
      if (sorted.length) {
        sorted.sort((a, b) => b[1] - a[1]);
        const lines = sorted.map((val) => `${val[0]}(${val[1]})`);
        msg.send(lines.join(", "));
      } else {
        msg.send(msg.random(responses));
      }
    }
  });

  robot.respond(/stats( \-\w)?/i, (msg) => {
    const sorted = listOfUsersWithCount(robot);
    if (msg.match[1] === undefined) {
      const name = msg.message.user.name;
      const sender = robot.brain.userForName(name);
      let isSenderInList = false;
      let response = "```Name : Message Count\n";
      if (sorted.length) {
        for (const user of sorted) {
          if (sender && sender.name === user[0]) {
            isSenderInList = true;
            break;
          }
        }
        const lines = sorted.map((val) => `${val[0]} : ${val[1]}`);
        response += lines.join("\n");
      }
      response += "```";
      if (!isSenderInList) {
        response += "\nCan't find your name?\n" + msg.random(responses);
      }
      msg.send(response);
    } else {
      if (msg.match[1] === " -b") {
        const name = sorted.map((val) => val[0]);
        const msgcount = sorted.map((val) => val[1]);
        const chart = {
          type: "bar",
          data: {
            labels: name,
            datasets: [
              {
                label: "Message Count",
                data: msgcount,
              },
            ],
          },
          options: {
            plugins: {
              datalabels: {
                display: true,
                color: "#fff",
              },
            },
          },
        };
        const data = encodeURIComponent(JSON.stringify(chart));
        const text = "Message Count";
        const alt = "Chart showing message count";
        graph(data, text, alt, (reply) => {
          msg.send({ attachments: JSON.stringify(reply) });
        });
      }
    }
  });

  // This will run every Saturday at 9 pm
  cron.schedule("0 0 21 * * Saturday", () => {
    const sorted = listOfUsersWithCount(robot);
    if (sorted[0]) {
      const name = sorted[0][0];
      const currMsgRecord = sorted[0][1];
      let message = `This week's top poster is @${name}`;
      message += ` with ${currMsgRecord} messages`;
      robot.send({ room: "general" }, message);
      if (currMsgRecord >= 50) {
        robot.emit("plusplus", { username: name });
      }
      for (const key of Object.keys(robot.brain.data.users)) {
        const user = robot.brain.data.users[key];
        if ((user.msgcount ?? 0) > 0) {
          user.msgcount = 0;
        }
      }
    }
  });
};

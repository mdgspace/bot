// Description:
//   Script for maininting scores of different users.
//
// Commands:
//   name++ or name-- : Adds/subtracts 1 point to/from user's score
//   hubot score name : Shows current score of the user

import type { Robot, Response } from "./runtime/types";

import { info } from "./util";

const responses = [
  "Flamboyant!",
  "Baroque!",
  "Impressive!",
  "Lustrous!",
  "Splashy!",
  "Superb!",
  "Splendid!",
];

interface ScoreResult {
  New: number;
  Name: string;
  Response: string;
}

function parse(json: string): string[][] {
  const result: string[][] = [];
  for (const line of json.toString().split("\n")) {
    result.push(line.split(",").map((s) => s.trim()));
  }
  // Same `if result != "" then result else false` dead-branch pattern as
  // info.ts/birthday.ts/batch-score.ts/httpd.ts — always returns the array,
  // never `false`. Preserved exactly.
  return result;
}

export = (robot: Robot): void => {
  const getChannel = (response: Response): string => {
    if (response.message.room === response.message.user.name) {
      return `@${response.message.room}`;
    } else {
      const isDM = response.message.room[0] === "D";
      const messageType = isDM ? "DM" : "unknown";
      return `#${messageType}`;
    }
  };

  robot.listenerMiddleware((context, next, done) => {
    try {
      // Check if it was called in a room.
      if (getChannel(context.response) === "#DM") {
        context.response.reply("This won't work here");
        // Skipping sending the message to general channel.
        // robot.send room: 'general', "@#{context.response.message.user.name} pls dont DM me. Talk here in public!"
        // Bypass executing the listener callback
        done();
      } else {
        next(done);
      }
    } catch (err) {
      robot.emit("error", err, context.response);
    }
  });

  // returns list of skipped words
  const skippedlist = (): string[] => {
    const list = robot.brain.get("skippedlist") || [];
    robot.brain.set("skippedlist", list);
    return list;
  };

  // return object to store data for all keywords
  // using this, stores the data in brain's "scorefield" key
  const scorefield = (): { [name: string]: number } => {
    const field = robot.brain.get("scorefield") || {};
    robot.brain.set("scorefield", field);
    return field;
  };

  const detailedfield = (): {
    [name: string]: {
      plus?: { [k: string]: number };
      minus?: { [k: string]: number };
    };
  } => {
    const field = robot.brain.get("detailedfield") || {};
    robot.brain.set("detailedfield", field);
    return field;
  };

  // returns last score
  const lastScore = (
    name: string,
    field: { [name: string]: number },
  ): number => {
    name = name.toLowerCase();
    return field[name] || 0;
  };

  // returns depreciation field associated to a single user
  const userFieldMinus = (user: string): { [k: string]: number } => {
    const Detailedfield = detailedfield();
    Detailedfield[user] = Detailedfield[user] || {};
    Detailedfield[user]["minus"] = Detailedfield[user]["minus"] || {};
    return Detailedfield[user]["minus"] as { [k: string]: number };
  };

  // returns appreciation field associated to a single user
  const userFieldPlus = (user: string): { [k: string]: number } => {
    const Detailedfield = detailedfield();
    Detailedfield[user] = Detailedfield[user] || {};
    Detailedfield[user]["plus"] = Detailedfield[user]["plus"] || {};
    return Detailedfield[user]["plus"] as { [k: string]: number };
  };

  // updates detailed field
  const updateDetailedScore = (
    field: { [k: string]: number },
    sendername: string,
    fieldtype: string,
  ): void => {
    if (fieldtype === "plus") {
      field[sendername] = field[sendername] + 1 || 1;
    } else {
      // The detailed map stores occurrence counts. detailed-score.ts turns
      // depreciation counts into negative chart values when rendering.
      field[sendername] = field[sendername] + 1 || 1;
    }
  };

  // updates score according to ++/--
  const updateScore = (
    word: string,
    field: { [name: string]: number },
    username: string,
    slackIds: string[],
  ): ScoreResult => {
    const posRegex = /\+\+/;
    const negRegex = /\-\-/;
    let name = "";
    let response = "";

    // if there is to be `plus` in score
    if (word.indexOf("++") >= 0) {
      name = word.replace(posRegex, "");
      if (username.toLowerCase() === name.toLowerCase()) {
        response = "-1";
      } else if (slackIds.includes(name)) {
        field[name.toLowerCase()] = lastScore(name, field) + 1;
        const userfield = userFieldPlus(name.toLowerCase());
        updateDetailedScore(userfield, username, "plus");
        response = responses[Math.floor(Math.random() * responses.length)];
      } else {
        response = "0";
      }

      // if there is to be `minus` in score
    } else if (word.indexOf("--") >= 0) {
      name = word.replace(negRegex, "");
      if (username.toLowerCase() === name.toLowerCase()) {
        response = "-1";
      } else if (slackIds.includes(name)) {
        field[name.toLowerCase()] = lastScore(name, field) - 1;
        const userfield = userFieldMinus(name.toLowerCase());
        updateDetailedScore(userfield, username, "minus");
        response = "Ouch!";
      } else {
        response = "0";
      }
    }

    const newscore = field[name.toLowerCase()];

    // returns 'name' and 'newscore' and 'response'
    return { New: newscore, Name: name, Response: response };
  };

  const getSlackIds = (callback: (slackIds: string[]) => void): void => {
    info((err, body) => {
      if (err || body == null) {
        robot.logger.warning(`leaderboard: could not fetch slack ids: ${err}`);
        return;
      }
      const slackIds: string[] = [];
      for (const user of parse(body)) {
        if (user.length >= 13 && user[10]) {
          slackIds.push(user[10]);
        }
      }
      callback(slackIds);
    });
  };

  // listen for any [word](++/--) in chat and react/update score
  robot.hear(/[a-zA-Z0-9\-_]+(\-\-|\+\+)/gi, (msg) => {
    // message for score update that bot will return
    let oldmsg = msg.message.text || "";

    // data-store object
    const ScoreField = scorefield();

    // skipped word list
    const SkippedList = skippedlist();

    // index keeping an eye on position, where next replace will be
    let start = 0;
    let end = 0;

    // reply only when there exist atleast one testword which
    // is neither skipped nor its length greater than 30
    let reply = false;
    let finalnewmsg = "";

    getSlackIds((slackIds) => {
      // for each ++/--
      for (let i = 0; i < msg.match.length; i++) {
        const testword = msg.match[i];

        end = start + testword.length;

        let newmsg: string;

        // check if testword is already skipped or it is too lengthy
        if (
          SkippedList.includes(testword.slice(0, -2)) ||
          testword.length > 30
        ) {
          newmsg = "";
        } else {
          reply = true;
          // updates Scoring for words, accordingly and returns result string
          const result = updateScore(
            testword,
            ScoreField,
            msg.message.user.name,
            slackIds,
          );

          // generates response message for reply
          if (result.Response === "-1") {
            newmsg = `${testword} [Sorry, You can't give ++ or -- to yourself.]`;
          } else if (result.Response === "0") {
            newmsg = `${result.Name}? Never heard of 'em `;
          } else {
            newmsg = `${testword} [${result.Response} You're now at ${result.New}] `;
          }
        }

        oldmsg = oldmsg.substr(0, start) + oldmsg.substr(end + 1);
        finalnewmsg += newmsg + "\n";
      }

      if (reply) {
        // reply with updated message
        msg.send(`${finalnewmsg}`);
      }
    });
  });

  // response for score status of any <keyword>
  robot.respond(/score ([\w\-_]+)/i, (msg) => {
    // we do not want to reply in case of batch score is requested
    const fxx = /f\d\d/i;
    if (fxx.exec(msg.match[0])) {
      return;
    }

    // data-store object
    const ScoreField = scorefield();

    // <keyword> whose score is to be shown
    const name = msg.match[1].toLowerCase();

    // If the key exist
    if (ScoreField[name] !== undefined) {
      // current score for keyword
      const currentscore = ScoreField[name];
      msg.send(`${name} : ${currentscore}`);
    } else {
      msg.send(`${name}? Never heard of 'em`);
    }
  });

  robot.on("plusplus", (event: { username: string }) => {
    const ScoreField = scorefield();
    const result = updateScore(
      `${event.username}++`,
      ScoreField,
      "MostWordsBot",
      [event.username],
    );
    const newmsg = `${event.username}++ [${result.Response} You're now at ${result.New}]`;
    robot.send({ room: "general" }, newmsg);
  });
};

// Description:
//   Script for batch wise score.
//
// Configuration:
//   INFO_SPREADSHEET_URL
//
// Commands:
//   hubot score fxx -> for tabular representation
//   hubot score fxx -b -> for bar graph
//   hubot score fxx -p -> for pie graph

import type { Robot } from "./runtime/types";
import { scoreForMember } from "./runtime/score-user";

import { graph, info } from "./util";

function stringLength(str: string | number): number {
  return String(str).split("").length;
}

// makes all the elements in the array equal in width by padding at right
function padright(array: string[]): string[] {
  let maxLength = 0;
  for (const name of array) {
    maxLength =
      maxLength >= stringLength(name) ? maxLength : stringLength(name);
  }
  const padding = maxLength;
  for (let i = 0; i <= array.length - 1; i++) {
    let max = padding - stringLength(array[i]);
    if (i === 0) {
      max = max + 3;
    }
    if (max > 0) {
      for (let j = 0; j <= max - 1; j++) {
        array[i] += " ";
      }
    }
  }
  return array;
}

// makes all the elements in the array equal in width by padding at left
function padleft(array: string[]): string[] {
  const padding = 5;
  for (let i = 0; i <= array.length - 1; i++) {
    const max = padding - stringLength(array[i]);
    let name = "";
    if (max > 0) {
      for (let j = 0; j <= max - 1; j++) {
        name += " ";
      }
    }
    name += array[i];
    array[i] = name;
  }
  return array;
}

function parse(json: string): string[][] | null {
  if (json.trim() === "") {
    return null;
  }
  const result: string[][] = [];
  for (const line of json.toString().split("\n")) {
    result.push(line.split(",").map((s) => s.trim()));
  }
  /* BUGFIX: see info.ts — the original CoffeeScript's dead `else false`
     branch meant parse() always returned the array, making the caller's
     `if (!result)` early-return unreachable. Returning null on an empty
     sheet restores that guard. */
  return result;
}

function member(
  members: string[][],
  year: number,
  callback: (res: [string[], string[][]]) => void,
): void {
  const userName: string[] = [];
  const slackId: string[][] = [];
  for (const user of members) {
    if (user.length >= 13) {
      const userYear = user[4].split("");
      const yearInfo = parseInt(userYear[0], 10);
      if (year === yearInfo) {
        if (user[10]) {
          slackId.push([user[10]]);
          userName.push(user[0]);
        }
      }
    }
  }
  callback([userName, slackId]);
}

export = (robot: Robot): void => {
  const scorefield = (): { [slackId: string]: number } => {
    const field = robot.brain.get("scorefield") || {};
    robot.brain.set("scorefield", field);
    return field;
  };

  robot.respond(/score f(\d\d)( \-\w)?/i, (msg) => {
    const scoreField = scorefield();

    // obtaining the current date to calculate relative_year
    const today = new Date();
    const mm = today.getMonth() + 1;
    const yyyy = today.getFullYear();
    const yy = yyyy % 100;
    const relativeYear = mm < 7 ? yy : yy + 1;

    // <batch> whose score is to be shown
    const batch = msg.match[1];
    const year = relativeYear - Number(batch);

    info((err, body) => {
      if (err || body == null) {
        robot.logger.warning(
          `batch-score: could not fetch member data: ${err}`,
        );
        return;
      }
      const result = parse(body);
      if (!result) {
        return;
      }
      member(result, year, ([userNameIn, slackIdIn]) => {
        let userName: string[] = userNameIn;
        // string[] normally, but a "Score" header string is prepended below.
        let slackId: Array<string | string[]> = slackIdIn;
        const userScore: (string | number)[] = [];

        if (msg.match[2] === undefined) {
          userName = ["```Name", ...userName];
          slackId = ["Score", ...slackId];
          for (let i = 1; i <= slackId.length - 1; i++) {
            // entries may be bare strings or single-element [id] arrays;
            // object-key coercion makes both behave identically.
            userScore[i] = scoreForMember(robot, scoreField, String(slackId[i]));
          }

          userName = padright(userName);
          const paddedScore = padleft(userScore.map((v) => String(v)));

          const sorted: [string, string][] = [];
          sorted.push([userName[0], String(slackId[0])]);
          for (let i = 1; i <= userName.length - 1; i++) {
            sorted.push([userName[i], paddedScore[i]]);
          }

          if (sorted.length) {
            sorted.sort((a, b) => Number(b[1]) - Number(a[1]));
          }

          const lines = sorted.map((val) => `${val[0]} : ${val[1]}`);
          let response = lines.join("\n");
          response += "```";
          msg.send(response);
        } else {
          const lastChar = msg.match[2];
          let graphType: string;
          if (lastChar === " -p") {
            graphType = "pie";
          } else if (lastChar === " -b") {
            graphType = "bar";
          } else {
            return;
          }

          const scores: number[] = [];
          for (let i = 0; i <= slackId.length - 1; i++) {
            scores[i] = scoreForMember(robot, scoreField, String(slackId[i]));
          }

          const chart = {
            type: graphType,
            data: {
              labels: userName,
              datasets: [
                {
                  label: "Score",
                  data: scores,
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
          const text = `Batch${batch} score`;
          const alt = `Chart showing score of batch${batch}`;
          graph(data, text, alt, (reply) => {
            msg.send({ attachments: JSON.stringify(reply) });
          });
        }
      });
    });
  });
};

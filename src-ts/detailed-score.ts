// Description:
//   Enlists all people who have given ++ or -- to a particular person

// Commands:
//   bot detailed score name
//   bot detailed score name -b  (for bar graph)

import type { Robot } from "./runtime/types";

import { graph } from "./util";

class Person {
  name: string;
  plus: number;
  minus: number;

  constructor(name: string, plus = 0, minus = 0) {
    this.name = name;
    this.plus = plus;
    this.minus = minus;
  }

  plusFn(val: number): void {
    this.plus += val;
  }

  minusFn(val: number): void {
    this.minus -= val;
  }
}

function isExist(list: Person[], name: string): number {
  let index = -1;
  let idx = 0;
  for (const person of list) {
    if (person.name === name) {
      index = idx;
    }
    idx++;
  }
  return index;
}

export = (robot: Robot): void => {
  robot.respond(/detailed score ([\w\-_]+)( \-\w)?/i, (msg) => {
    // <keyword> whose score is to be shown
    if (msg.match[2] === undefined) {
      const name = msg.match[1].toLowerCase();
      let plusField: [string, number][] = [];
      let minusField: [string, number][] = [];
      const detailedfield = robot.brain.get("detailedfield") || {};
      let response = "";
      if (detailedfield[name]) {
        if (detailedfield[name]["plus"]) {
          response += "Appreciations\n";
          for (const key of Object.keys(detailedfield[name]["plus"])) {
            plusField.push([key, detailedfield[name]["plus"][key]]);
          }
          const plusLines = plusField.map((val) => `${val[0]} : ${val[1]}\n`);
          response += plusLines.join("\n");
        }
        if (detailedfield[name]["minus"]) {
          response += "\nDepreciations\n";
          for (const key of Object.keys(detailedfield[name]["minus"])) {
            minusField.push([key, detailedfield[name]["minus"][key]]);
          }
          const minusLines = minusField.map((val) => `${val[0]} : ${val[1]}\n`);
          response += minusLines.join("\n");
        }
      } else {
        response += "Sorry ! No such user";
      }
      msg.send(response);
    } else {
      if (msg.match[2] === " -b") {
        const name = msg.match[1].toLowerCase();
        const detailedfield = robot.brain.get("detailedfield") || {};
        const list: Person[] = [];
        if (detailedfield[name]) {
          if (detailedfield[name]["plus"]) {
            for (const key of Object.keys(detailedfield[name]["plus"])) {
              list.push(new Person(key, detailedfield[name]["plus"][key], 0));
            }
          }

          if (detailedfield[name]["minus"]) {
            for (const key of Object.keys(detailedfield[name]["minus"])) {
              const value = detailedfield[name]["minus"][key];
              const idx = isExist(list, key);
              if (idx !== -1) {
                list[idx].minusFn(value);
              } else {
                list.push(new Person(key, 0, -value));
              }
            }
          }
        } else {
          msg.send("No such user found!");
          return;
        }

        const nameList: string[] = [];
        const plus: number[] = [];
        const minus: number[] = [];

        list.forEach((p) => {
          nameList.push(p.name);
          plus.push(p.plus);
          minus.push(p.minus);
        });

        /* BUGFIX: original CoffeeScript nested `options` inside `data`
         instead of as a sibling of it. Chart.js (and QuickChart, which
         renders this via util.graph) reads `options` from the top level of
         the config — nested inside `data` it was silently ignored, so the
         chart title and the datalabels styling never actually applied.
         Fixed by moving `options` up to be a sibling of `type`/`data`.*/
        const chartConfig = {
          type: "bar",
          data: {
            labels: nameList,
            datasets: [
              {
                label: "++",
                backgroundColor: "rgba(54, 162, 235, 0.5)",
                borderColor: "rgba(54, 162, 235)",
                borderWidth: 1,
                data: plus,
              },
              {
                label: "--",
                backgroundColor: "rgba(255, 99, 132, 0.5)",
                borderColor: "rgba(255, 99, 132)",
                borderWidth: 1,
                data: minus,
              },
            ],
          },
          options: {
            title: {
              display: true,
              text: `Detailed Score of ${name}`,
            },
            plugins: {
              datalabels: {
                anchor: "center",
                align: "center",
                color: "#666",
                font: {
                  weight: "normal",
                },
              },
            },
          },
        };
        const chart = encodeURIComponent(JSON.stringify(chartConfig));
        const text = `Detailed Score of ${name}`;
        graph(
          chart,
          text,
          "Graph Showing Detailed Score",
          (reply) => {
            msg.send({ attachments: JSON.stringify(reply) });
          },
        );
      }
    }
  });
};

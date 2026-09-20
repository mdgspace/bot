// Description:
//   A simple interaction with the built in HTTP Daemon
//
// Dependencies:
//   None
//
// Configuration:
//   None
//
// Commands:
//   None
//
// URLS:
//   /hubot/version
//   /hubot/ping
//   /hubot/time
//   /hubot/info
//   /hubot/ip

import type { Robot } from "./runtime/types";

import { spawn } from "child_process";
import { info } from "./util";

interface DialogflowItem {
  simpleResponse?: { textToSpeech: string };
  basicCard?: { formattedText: string; title: string };
  carouselBrowse?: {
    items: Array<{ description: string; title: string; openUrlAction: { url: string } }>;
  };
}

interface DialogflowResponse {
  fulfillmentText: string;
  fulfillmentMessages: unknown[];
  source: string;
  payload: {
    google: {
      expectUserResponse: boolean;
      richResponse: { items: DialogflowItem[] };
    };
  };
}

function parse(json: string, query: string): string[][] {
  const result: string[][] = [];
  for (const line of json.toString().split("\n")) {
    const y = line.toLowerCase().indexOf(query);
    if (y !== -1) {
      result.push(line.split(",").map((s) => s.trim()));
    }
  }
  // Original CoffeeScript: `if result != "" then result else false`.
  // `result` is always an array, which is never `!=`-equal to a string in a
  // way that resolves false — the comparison is always true, so the `else
  // false` branch never executes. parse() always returns the array (even
  // when empty), never `false`. Preserved exactly, not "fixed."
  return result;
}

export = (robot: Robot): void => {
  robot.router.get("/hubot/version", (req, res) => {
    res.end(robot.version);
  });

  robot.router.post("/hubot/ping", (req, res) => {
    res.end("PONG");
  });

  robot.router.get("/hubot/time", (req, res) => {
    res.end(`Server time is: ${new Date()}`);
  });

  robot.router.get("/hubot/info", (req, res) => {
    const child = spawn("/bin/sh", [
      "-c",
      "echo I\\'m $LOGNAME@$(hostname):$(pwd) \\($(git rev-parse HEAD)\\)",
    ]);

    let output = "";
    let stderr = "";
    child.stdout.on("data", (data: Buffer) => {
      output += data.toString();
    });
    child.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });
    child.on("error", (error) => {
      if (!res.finished) {
        res.statusCode = 500;
        res.end(`Unable to inspect process: ${error.message}`);
      }
    });
    child.on("close", (code) => {
      if (res.finished) {
        return;
      }
      if (code !== 0) {
        res.statusCode = 500;
        res.end(`Unable to inspect process: ${stderr.trim()}`);
        return;
      }
      res.end(
        `${output.trim()} running node ${process.version} [pid: ${process.pid}]`,
      );
    });
  });

  robot.router.get("/hubot/ip", (req, res) => {
    robot.http("http://ifconfig.me/ip").get()((err, r, body) => {
      if (err || !r || body == null) {
        res.statusCode = 502;
        res.end("Unable to determine public IP");
        return;
      }
      res.end(body);
    });
  });

  robot.router.post("/hubot/slack", (request, response) => {
    const check = process.env.HUBOT_ENV_AUTH_TOKEN;

    /* SECURITY FIX: the original compared with plain `===`, so when the
       token env var was unset AND no Authorization header was sent,
       `undefined === undefined` authenticated the request. Fail closed
       instead: no configured token means always unauthorized. */
    if (check && request.headers.authorization === check) {
      const data = request.body;
      const parameters = data?.queryResult?.parameters;
      if (!parameters || typeof parameters.name !== "string") {
        response.writeHead(400, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: "invalid Dialogflow payload" }));
        return;
      }
      let responseobj: DialogflowResponse;
      if (parameters.name === "") {
        robot.send(
          { room: "general" },
          `Announcement : '${parameters.any}'`,
        );
        responseobj = {
          fulfillmentText: "Announcement sent",
          fulfillmentMessages: [],
          source: " ",
          payload: {
            google: {
              expectUserResponse: false,
              richResponse: {
                items: [
                  {
                    simpleResponse: { textToSpeech: "Announcement sent" },
                  },
                ],
              },
            },
          },
        };
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify(responseobj));
      } else {
        const query = parameters.name.toLowerCase();
        info((err, body) => {
          if (err || body == null) {
            response.writeHead(500, { "Content-Type": "application/json" });
            response.end(
              JSON.stringify({ error: "could not fetch member data" }),
            );
            return;
          }
          const results = parse(body, query);
          if (results.length === 0) {
            responseobj = {
              fulfillmentText: "This is a text response",
              fulfillmentMessages: [],
              source: " ",
              payload: {
                google: {
                  expectUserResponse: true,
                  richResponse: {
                    items: [
                      {
                        simpleResponse: {
                          textToSpeech: "No user found",
                        },
                      },
                    ],
                  },
                },
              },
            };
          } else {
            if (results.length === 1) {
              responseobj = {
                fulfillmentText: "This is a text response",
                fulfillmentMessages: [],
                source: " ",
                payload: {
                  google: {
                    expectUserResponse: true,
                    richResponse: {
                      items: [
                        {
                          simpleResponse: {
                            textToSpeech: "Here it is",
                          },
                        },
                        {
                          basicCard: {
                            formattedText:
                              "Github : " +
                              results[0][8] +
                              "\n  \nMobile : " +
                              results[0][1] +
                              "\n  \nEmail : " +
                              results[0][2] +
                              "\n  \n" +
                              results[0][4] +
                              "    " +
                              results[0][5] +
                              "    (" +
                              results[0][6] +
                              ")",
                            title: results[0][0],
                          },
                        },
                      ],
                    },
                  },
                },
              };
            } else {
              const basicCardArray = [];
              for (const user of results) {
                const basicCardArray1 = {
                  description:
                    "Github : " +
                    user[8] +
                    "\nMobile : " +
                    user[1] +
                    "\nEmail : " +
                    user[2] +
                    "\n" +
                    user[4] +
                    "       " +
                    user[5] +
                    "   (" +
                    user[6] +
                    ")",
                  title: user[0],
                  openUrlAction: {
                    url: "https://github.com/" + user[8],
                  },
                };
                basicCardArray.push(basicCardArray1);
              }
              responseobj = {
                fulfillmentText: "This is a text response",
                fulfillmentMessages: [],
                source: " ",
                payload: {
                  google: {
                    expectUserResponse: true,
                    richResponse: {
                      items: [
                        {
                          simpleResponse: {
                            textToSpeech: "Here it is",
                          },
                        },
                        {
                          carouselBrowse: {
                            items: basicCardArray,
                          },
                        },
                      ],
                    },
                  },
                },
              };
            }
          }
          response.writeHead(200, {
            "Content-Type": "application/json",
          });
          response.end(JSON.stringify(responseobj));
        });
      }
    } else {
      robot.logger.warning("httpd: unauthorized /hubot/slack request");
      response.writeHead(401);
      response.end();
    }
  });
};

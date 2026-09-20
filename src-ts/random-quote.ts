// Description:
//   Fetches and sends a random quote from the internet.
//
// Dependencies:
//   node-soupselect
//   node-htmlparser
//
// Configuration:
//   NONE
//
// Commands:
//   random quote

import type { Robot } from "./runtime/types";

import { select } from "soupselect";
import * as htmlparser from "htmlparser";

type QuoteCallback = (
  success: boolean,
  quote?: string,
  author?: string,
) => void;

export = (robot: Robot): void => {
  const fetchRandomQuote = (callback: QuoteCallback): void => {
    robot.http("http://inspirationalshit.com/endlessquotesrotator.php").get()(
      (err, res, body) => {
        if (err || !res || body == null) {
          callback(false);
          return;
        }
        if (res.statusCode !== 200) {
          callback(false);
          return;
        }

        const handler = new htmlparser.DefaultHandler(
          (err2, dom) => {
            if (err2) {
              callback(false);
            } else {
              const quote = select(dom, "blockquote p")[0]?.children?.[0]?.raw;
              const author = select(dom, "blockquote footer cite")[0]
                ?.children?.[0]?.raw;
              if (quote && author) {
                callback(true, quote, author);
              } else {
                callback(false);
              }
            }
          },
        );

        const parser = new htmlparser.Parser(handler);
        parser.parseComplete(body);
      },
    );
  };

  robot.respond(/.*random.*quote.*/i, (msg) => {
    fetchRandomQuote((success, quote, author) => {
      if (success) {
        msg.send(`_${quote}_ - ${author}`);
      } else {
        msg.send("_error_");
      }
    });
  });

  robot.on("send:quote", (randomMsg: string) => {
    fetchRandomQuote((success, quote, author) => {
      let text = randomMsg;
      if (success) {
        text = `_${quote}_ - ${author}`;
      }
      robot.send({ room: "general" }, text);
    });
  });
};

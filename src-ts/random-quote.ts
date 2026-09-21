// Description:
//   Fetches and sends a random quote from the internet.
//
// Dependencies:
//   htmlparser2
//
// Configuration:
//   NONE
//
// Commands:
//   random quote

import type { Robot } from "./runtime/types";

import { parseDocument, DomUtils } from "htmlparser2";

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

        const blocks = DomUtils.getElementsByTagName("blockquote", parseDocument(body, { decodeEntities: false }).children);
        const paragraphs = blocks.flatMap(block => DomUtils.getElementsByTagName("p", block.children));
        const citations = blocks.flatMap(block => DomUtils.getElementsByTagName("footer", block.children))
          .flatMap(footer => DomUtils.getElementsByTagName("cite", footer.children));
        const quote = paragraphs[0]?.children[0];
        const author = citations[0]?.children[0];
        if (quote?.type === "text" && author?.type === "text" && quote.data && author.data)
          callback(true, quote.data, author.data);
        else callback(false);
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

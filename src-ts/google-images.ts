// Description:
//   A way to interact with the Google Images API.
//
// Configuration
//   HUBOT_GOOGLE_CSE_KEY - Your Google developer API key
//   HUBOT_GOOGLE_CSE_ID - The ID of your Custom Search Engine
//   HUBOT_MUSTACHIFY_URL - Optional. Allow you to use your own mustachify instance.
//   HUBOT_GOOGLE_IMAGES_HEAR - Optional. If set, bot will respond to any line that begins with "image me" or "animate me" without needing to address the bot directly
//   HUBOT_GOOGLE_SAFE_SEARCH - Optional. Search safety level.
//   HUBOT_GOOGLE_IMAGES_FALLBACK - The URL to use when API fails. `{q}` will be replaced with the query string.
//
// Commands:
//   hubot image me <query> - The Original. Queries Google Images for <query> and returns a random top result.
//   hubot animate me <query> - The same thing as `image me`, except adds a few parameters to try to return an animated GIF instead.
//   hubot mustache me <url|query> - Adds a mustache to the specified URL or query result.

import type { Robot, Response } from "./runtime/types";

type ImageCallback = (url: string) => void;

// Forces the URL look like an image URL by adding `#.png`
function ensureImageExtension(url: string): string {
  if (/(png|jpe?g|gif)$/i.test(url)) {
    return url;
  }
  return `${url}#.png`;
}

// Forces giphy result to use animated version
function ensureResult(url: string, animated?: boolean): string {
  if (animated === true) {
    return ensureImageExtension(
      url.replace(/(giphy\.com\/.*)\/.+_s.gif$/, "$1/giphy.gif"),
    );
  }
  return ensureImageExtension(url);
}

function deprecatedImage(
  msg: Response,
  query: string,
  animated: boolean | undefined,
  faces: boolean | undefined,
  cb: ImageCallback,
): void {
  // Show a fallback image
  let imgUrl =
    process.env.HUBOT_GOOGLE_IMAGES_FALLBACK ||
    "http://i.imgur.com/CzFTOkI.png";
  imgUrl = imgUrl.replace(/\{q\}/, encodeURIComponent(query));
  cb(ensureResult(imgUrl, animated));
}

interface GoogleImage {
  link: string;
}

interface GoogleImageError {
  message?: string;
  extendedHelp?: string;
}

interface GoogleImageResponse {
  items?: GoogleImage[];
  error?: { errors?: GoogleImageError[] };
}

function imageMe(
  msg: Response,
  query: string,
  animated: boolean | ImageCallback,
  faces?: boolean | ImageCallback,
  cb?: ImageCallback,
): void {
  let animatedFlag: boolean | undefined =
    typeof animated === "boolean" ? animated : undefined;
  let facesFlag: boolean | undefined =
    typeof faces === "boolean" ? faces : undefined;
  // Resolve the overloaded-argument form used by the original CoffeeScript:
  // a trailing function argument wins over the optional `cb` parameter.
  const callback: ImageCallback | undefined =
    typeof faces === "function"
      ? faces
      : typeof animated === "function"
        ? animated
        : cb;
  if (!callback) {
    throw new Error("imageMe requires a callback");
  }
  if (typeof animated === "function") {
    animatedFlag = undefined;
  }
  if (typeof faces === "function") {
    facesFlag = undefined;
  }

  const googleCseId = process.env.HUBOT_GOOGLE_CSE_ID;
  if (googleCseId) {
    // Using Google Custom Search API
    const googleApiKey = process.env.HUBOT_GOOGLE_CSE_KEY;
    if (!googleApiKey) {
      msg.robot.logger.error(
        "Missing environment variable HUBOT_GOOGLE_CSE_KEY",
      );
      msg.send("Missing server environment variable HUBOT_GOOGLE_CSE_KEY.");
      return;
    }
    const q: { [key: string]: string } = {
      q: query,
      searchType: "image",
      safe: process.env.HUBOT_GOOGLE_SAFE_SEARCH || "high",
      fields: "items(link)",
      cx: googleCseId,
      key: googleApiKey,
    };
    if (animatedFlag === true) {
      q.fileType = "gif";
      q.hq = "animated";
      q.tbs = "itp:animated";
    }
    if (facesFlag === true) {
      q.imgType = "face";
    }
    const url = "https://www.googleapis.com/customsearch/v1";
    msg.http(url).query(q).get()((err, res, body) => {
      if (err || !res || body == null) {
        msg.send(`Encountered an error :( ${err || "empty response"}`);
        return;
      }
      if (res.statusCode === 403) {
        msg.send("Daily image quota exceeded, using alternate source.");
        deprecatedImage(msg, query, animatedFlag, facesFlag, callback);
        return;
      }
      if (res.statusCode !== 200) {
        msg.send(`Bad HTTP response :( ${res.statusCode}`);
        return;
      }
      let response: GoogleImageResponse;
      try {
        response = JSON.parse(body);
      } catch (error) {
        msg.robot.logger.error(error);
        msg.send("Google Images returned a malformed response.");
        return;
      }
      if (response && response.items && response.items.length > 0) {
        const image = msg.random(response.items);
        callback(ensureResult(image.link, animatedFlag));
      } else {
        msg.send(`Oops. I had trouble searching '${query}'. Try later.`);
        if (response.error && response.error.errors) {
          for (const error of response.error.errors) {
            msg.robot.logger.error(error.message);
            if (error.extendedHelp) {
              msg.robot.logger.error(`(see ${error.extendedHelp})`);
            }
          }
        }
      }
    });
  } else {
    msg.send(
      "Google Image Search API is no longer available. " +
        "Please [setup up Custom Search Engine API](https://github.com/hubot-scripts/hubot-google-images#cse-setup-details).",
    );
    deprecatedImage(msg, query, animatedFlag, facesFlag, callback);
  }
}

export = (robot: Robot): void => {
  robot.respond(/(image|img)( me)? (.+)/i, (msg) => {
    imageMe(msg, msg.match[3], (url) => {
      msg.send(url);
    });
  });

  robot.respond(/animate( me)? (.+)/i, (msg) => {
    imageMe(msg, msg.match[2], true, (url) => {
      msg.send(url);
    });
  });

  // pro feature, not added to docs since you can't conditionally document commands
  if (process.env.HUBOT_GOOGLE_IMAGES_HEAR) {
    robot.hear(/^(image|img) me (.+)/i, (msg) => {
      imageMe(msg, msg.match[2], (url) => {
        msg.send(url);
      });
    });

    robot.hear(/^animate me (.+)/i, (msg) => {
      imageMe(msg, msg.match[1], true, (url) => {
        msg.send(url);
      });
    });
  }

  robot.respond(/(?:mo?u)?sta(?:s|c)h(?:e|ify)?(?: me)? (.+)/i, (msg) => {
    if (!process.env.HUBOT_MUSTACHIFY_URL) {
      msg.send(
        "Sorry, the Mustachify server is not configured.",
        "http://i.imgur.com/BXbGJ1N.png",
      );
      return;
    }
    const mustacheBaseUrl = process.env.HUBOT_MUSTACHIFY_URL.replace(/\/$/, "");
    const mustachify = `${mustacheBaseUrl}/rand?src=`;
    const imagery = msg.match[1];

    if (imagery.match(/^https?:\/\//i)) {
      const encodedUrl = encodeURIComponent(imagery);
      msg.send(`${mustachify}${encodedUrl}`);
    } else {
      imageMe(msg, imagery, false, true, (url) => {
        const encodedUrl = encodeURIComponent(url);
        msg.send(`${mustachify}${encodedUrl}`);
      });
    }
  });
};

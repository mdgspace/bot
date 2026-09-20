// Description:
//   YouTube video search
//
// Configuration:
//   HUBOT_YOUTUBE_API_KEY - Obtained from https://console.developers.google.com
//   HUBOT_YOUTUBE_DETERMINISTIC_RESULTS - Optional boolean flag to only fetch
//     the top result from the YouTube search
//   HUBOT_YOUTUBE_HEAR - Optional boolean flag to globally hear from channels
// Commands:
//   hubot youtube me <query> - Searches YouTube for the query and returns the video embed link.

import type { Robot, Response } from "./runtime/types";

interface YoutubeSearchItem {
  id?: { videoId?: string };
}

interface YoutubeSearchResponse {
  items?: YoutubeSearchItem[];
  error?: unknown;
}

export = (robot: Robot): void => {
  let resType: "respond" | "hear" = "respond";
  let trigger = /(?:youtube|yt)(?: me)? (.*)/i;
  if (process.env.HUBOT_YOUTUBE_HEAR === "true") {
    resType = "hear";
    trigger = /^(?:youtube|yt)(?: me)? (.*)/i;
  }

  const handler = (msg: Response): void => {
    if (!process.env.HUBOT_YOUTUBE_API_KEY) {
      robot.logger.error("HUBOT_YOUTUBE_API_KEY is not set.");
      msg.send(
        "You must configure the HUBOT_YOUTUBE_API_KEY environment variable",
      );
      return;
    }
    const query = msg.match[1];
    const maxResults =
      process.env.HUBOT_YOUTUBE_DETERMINISTIC_RESULTS === "true" ? 1 : 15;
    robot.logger.debug(`Query: ${query}\n Max Results: ${maxResults}`);
    robot
      .http("https://www.googleapis.com/youtube/v3/search")
      .query({
        order: "relevance",
        part: "snippet",
        type: "video",
        maxResults: maxResults,
        q: query,
        key: process.env.HUBOT_YOUTUBE_API_KEY,
      })
      .get()((err, res, body) => {
      robot.logger.debug(body);
      if (err || !res || body == null) {
        robot.logger.error(err || "YouTube returned an empty response");
        robot.emit("error", err || new Error("Empty YouTube response"), msg);
        return;
      }
      let videos: YoutubeSearchResponse | undefined;
      try {
        if (res.statusCode === 200) {
          videos = JSON.parse(body);
          robot.logger.debug(`Videos: ${JSON.stringify(videos)}`);
        } else {
          robot.emit("error", `${res.statusCode}: ${body}`, msg);
          return;
        }
      } catch (error) {
        robot.logger.error(error);
        msg.send(`Error! ${body}`);
        return;
      }
      if (videos?.error) {
        robot.logger.error(videos.error);
        msg.send(`Error! ${JSON.stringify(videos.error)}`);
        return;
      }
      const items = videos?.items;
      if (!items || items.length === 0) {
        msg.send(`No video results for "${query}"`);
        return;
      }
      const video = msg.random(items);
      const videoId = video.id?.videoId;
      if (!videoId) {
        msg.send("Got a malformed result from YouTube, try again.");
        return;
      }
      msg.send(`https://www.youtube.com/watch?v=${videoId}`);
    });
  };

  robot[resType](trigger, handler);
};

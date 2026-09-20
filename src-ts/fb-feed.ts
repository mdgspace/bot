// Description:
//   Fetch random posts from any facebook page
//
// Dependencies:
//   https
//
// Configuration:
//   FB_APP_ACCESS_TOKEN
//
// Commands:
//   hubot fb feed <page-id>

import type { Robot } from "./runtime/types";

import * as https from "https";

const fbAccessToken = process.env.FB_APP_ACCESS_TOKEN;
const accessToken = `access_token=${fbAccessToken || ""}`;

interface FbPost {
  id: string;
  message?: string;
  created_time: string;
}

interface FbPage {
  name?: string;
  link?: string;
  picture?: { data?: { url?: string } };
}

interface FeedAttachment {
  fallback?: string;
  color: string;
  author_name?: string;
  author_link?: string;
  author_icon?: string;
  title?: string;
  title_link: string;
  ts: number;
  footer?: string;
  image_url?: string;
}

interface FbFeedResponse {
  likes?: { summary?: { total_count?: number } };
  attachments?: { data?: Array<{ media?: { image?: { src?: string } } }> };
  data?: FbPost[];
}

function fetchJson<T>(
  robot: Robot,
  path: string,
  label: string,
  callback: (err: Error | null, data?: T) => void,
): void {
  let complete = false;
  const finish = (err: Error | null, data?: T): void => {
    if (complete) {
      return;
    }
    complete = true;
    callback(err, data);
  };
  const request = https.get({ host: "graph.facebook.com", path }, (res) => {
    let data = "";
    res.on("data", (chunk) => {
      data += chunk.toString();
    });
    res.on("end", () => {
      if (res.statusCode != null && res.statusCode >= 400) {
        finish(new Error(`${label} returned HTTP ${res.statusCode}`));
        return;
      }
      try {
        finish(null, JSON.parse(data) as T);
      } catch (error) {
        finish(new Error(`${label} returned malformed JSON: ${error}`));
      }
    });
    res.on("error", (error) => {
      finish(error);
    });
  });
  request.on("error", (error) => {
    robot.logger.warning(`fb-feed: ${label} request failed: ${error}`);
    finish(error);
  });
}

function fetchPostAttachments(
  robot: Robot,
  postId: string,
  callback: (err: Error | null, likes?: number, imageUrl?: string) => void,
): void {
  const path = `/${postId}/?${accessToken}&fields=attachments{media},likes.limit(0).summary(true)`;
  fetchJson<FbFeedResponse>(robot, path, "post attachments", (err, parsed) => {
    if (err || !parsed) {
      callback(err || new Error("empty post attachment response"));
      return;
    }
    const likes = parsed.likes?.summary?.total_count ?? 0;
    const imageUrl = parsed.attachments?.data?.[0]?.media?.image?.src;
    callback(null, likes, imageUrl);
  });
}

function fetchPageDetails(
  robot: Robot,
  pageName: string,
  callback: (err: Error | null, page?: FbPage) => void,
): void {
  const path = `/${pageName}?${accessToken}&fields=name,link,about,picture{url}`;
  fetchJson<FbPage>(robot, path, "page details", callback);
}

// returns a random post from a given fb page
function getRandomPost(
  robot: Robot,
  pageName: string,
  callback: (err: Error | null, output?: FeedAttachment) => void,
): void {
  const path = `/${pageName}/feed?${accessToken}`;
  fetchJson<FbFeedResponse>(robot, path, "page feed", (feedErr, feed) => {
    if (feedErr || !feed) {
      callback(feedErr || new Error("empty page feed response"));
      return;
    }
    const posts = feed.data || [];
    const post = posts[Math.floor(posts.length * Math.random())];
    if (!post) {
      callback(new Error("Facebook returned no posts"));
      return;
    }
    fetchPageDetails(robot, pageName, (pageErr, page) => {
      if (pageErr || !page) {
        callback(pageErr || new Error("empty page details response"));
        return;
      }
      const output: FeedAttachment = {
        fallback: post.message,
        color: "#fc554d",
        author_name: page.name,
        author_link: page.link,
        author_icon: page.picture?.data?.url,
        title: post.message,
        title_link: `https://facebook.com/${post.id}`,
        ts: new Date(post.created_time).getTime() / 1000,
      };
      fetchPostAttachments(robot, post.id, (attachmentErr, likes, imageUrl) => {
        if (attachmentErr) {
          callback(attachmentErr);
          return;
        }
        output.footer = `${likes || 0} Likes`;
        if (imageUrl) {
          output.image_url = imageUrl;
        }
        callback(null, output);
      });
    });
  });
}

export = (robot: Robot): void => {
  robot.on("send:fb-feed", (pageName: string) => {
    if (!fbAccessToken) {
      robot.logger.warning("fb-feed: FB_APP_ACCESS_TOKEN is not configured");
      return;
    }
    getRandomPost(robot, pageName, (err, data) => {
      if (err || !data) {
        robot.logger.warning(`fb-feed: ${err}`);
        return;
      }
      robot.send({ room: "general" }, { attachments: [data] });
    });
  });

  robot.respond(/fb feed (.+)$/i, (msg) => {
    if (!fbAccessToken) {
      msg.send("Looks like `FB_APP_ACCESS_TOKEN` is missing :thinking_face:");
    } else {
      const pageName = msg.match[1].trim();
      getRandomPost(robot, pageName, (err, data) => {
        if (err || !data) {
          robot.logger.warning(`fb-feed: ${err}`);
          msg.send("I couldn't fetch that Facebook feed right now.");
          return;
        }
        msg.send({ attachments: [data] });
      });
    }
  });
};

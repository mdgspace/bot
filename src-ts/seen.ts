// Description:
//   A hubot script that tracks when/where users were last seen.
//
// Commands:
//   hubot seen <user> - show when and where user was last seen
//   hubot seen in last 24h - list users seen in last 24 hours
//
// Configuration:
//   HUBOT_SEEN_TIMEAGO - If set to `false` (defaults to `true`), last seen times will be absolute dates instead of relative

import type { Robot, Response } from "./runtime/types";

import timeago from "node-time-ago";

const config = {
  use_timeago: process.env.HUBOT_SEEN_TIMEAGO !== "false",
};

function clean(thing: string | undefined | false): string {
  return (thing || "").toLowerCase().trim();
}

function isPm(msg: Response): boolean {
  return msg.message.channel?.is_im ?? !!msg.message.user.pm;
}

function ircname(msg: Response): string {
  return msg.message.user.name;
}

function ircchan(msg: Response): string | undefined {
  return msg.message.user.room;
}

interface SeenEntry {
  chan: string;
  date: number;
}

class Seen {
  robot: Robot;
  cache: { [name: string]: SeenEntry };

  constructor(robot: Robot) {
    this.robot = robot;
    this.cache = {};

    this.robot.brain.on("loaded", () => {
      this.cache = this.robot.brain.data.seen || {};
    });
  }

  save = (): void => {
    // TODO: should we try to only write changes to the db, instead of the entire map?
    this.robot.brain.data.seen = this.cache;
  };

  add(user: string, channel: string, msg: string): void {
    this.robot.logger.debug(`seen.add ${clean(user)} on ${channel}`);
    this.cache[clean(user)] = {
      chan: channel,
      date: Number(new Date()),
    };
    this.save();
  }

  last(user: string): Partial<SeenEntry> {
    return this.cache[clean(user)] || {};
  }

  usersSince(hoursAgo: number): string[] {
    const HOUR_MILLISECONDS = 60 * 60 * 1000;
    const seenSinceTime = new Date(Date.now() - hoursAgo * HOUR_MILLISECONDS);
    const users: string[] = [];
    for (const nick of Object.keys(this.cache)) {
      if (this.cache[nick].date > Number(seenSinceTime)) {
        users.push(nick);
      }
    }
    return users;
  }
}

export = (robot: Robot): void => {
  const seen = new Seen(robot);

  // Keep track of last msg heard
  robot.hear(/.*/, (msg) => {
    if (!isPm(msg)) {
      seen.add(clean(ircname(msg)), ircchan(msg) || "", msg.message.text || "");
    }
  });

  robot.respond(/seen @?([-\w.\\^|{}`\[\]]+):? ?(.*)/, (msg) => {
    if (msg.match[1] === "in" && msg.match[2] === "last 24h") {
      const users = seen.usersSince(24);
      msg.send(`Active in ${msg.match[2]}: ${users.join(", ")}`);
    } else {
      robot.logger.debug(`seen check ${clean(msg.match[1])}`);
      const nick = msg.match[1];
      const last = seen.last(nick);
      if (last.date) {
        let dateString: string;
        if (config.use_timeago) {
          dateString = timeago(new Date(last.date));
        } else {
          dateString = `at ${new Date(last.date)}`;
        }

        msg.send(`${nick} was last seen ${dateString} in #${last.chan}`);
      } else {
        msg.send(`I haven't seen ${nick} around lately`);
      }
    }
  });
};

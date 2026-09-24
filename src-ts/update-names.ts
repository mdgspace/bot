// Description:
//   Script for updating names database
//
// Commands:
//   hubot update db

import type { Response, Robot } from "./runtime/types";

export = (robot: Robot): void => {
  const slack = robot.slack;
  if (!slack) {
    return;
  }

  interface UpdateRun {
    parsedUsers: number;
    updatedUsers: number;
    totalUsers: number;
    response: Response;
  }

  const reportIfComplete = (run: UpdateRun): void => {
    if (run.parsedUsers === run.totalUsers) {
      run.response.send(`Updated names for ${run.updatedUsers} out of ${run.totalUsers} users`);
    }
  };

  const updateName = async (uid: string, run: UpdateRun): Promise<void> => {
    try {
      const data = await slack.userInfo(uid);
      if (data.name) {
        const user = robot.brain.userForId(data.id);
        if (user.name !== data.name) {
          user.name = data.name;
          run.updatedUsers++;
        }
      }
    } catch (error) {
      robot.logger.warning(`update-names: request failed for ${uid}: ${error}`);
    } finally {
      run.parsedUsers++;
      reportIfComplete(run);
    }
  };

  let running = false;
  robot.respond(/update db/i, async (msg) => {
    if (running) { msg.send("Names database update is already running"); return; }
    msg.send("Updating names in database");
    const ids = Object.values(robot.brain.data.users).map(user => user.id).filter(id => /^[UW][A-Z0-9]+$/.test(id));
    const run: UpdateRun = {
      parsedUsers: 0,
      updatedUsers: 0,
      totalUsers: ids.length,
      response: msg,
    };
    if (run.totalUsers === 0) {
      reportIfComplete(run);
      return;
    }
    running = true;
    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < ids.length) await updateName(ids[next++], run);
    };
    try { await Promise.all([worker(), worker()]); }
    finally { running = false; }
  });
};

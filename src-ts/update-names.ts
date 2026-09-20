// Description:
//   Script for updating names database
//
// Commands:
//   hubot update db

import type { Robot } from "./runtime/types";

export = (robot: Robot): void => {
  const slack = robot.slack;
  if (!slack) {
    return;
  }

  interface UpdateRun {
    parsedUsers: number;
    updatedUsers: number;
    totalUsers: number;
    room: string;
  }

  const reportIfComplete = (run: UpdateRun): void => {
    if (run.parsedUsers === run.totalUsers) {
      robot.send(
        { room: run.room },
        `Updated names for ${run.updatedUsers} out of ${run.totalUsers} users`,
      );
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

  robot.respond(/update db/i, (msg) => {
    msg.send("Updating names in database");
    const run: UpdateRun = {
      parsedUsers: 0,
      updatedUsers: 0,
      totalUsers: Object.keys(robot.brain.data.users).length,
      room: msg.message.user.room || msg.message.room,
    };
    if (run.totalUsers === 0) {
      reportIfComplete(run);
      return;
    }
    for (const key of Object.keys(robot.brain.data.users)) {
      void updateName(robot.brain.data.users[key].id, run);
    }
  });
};

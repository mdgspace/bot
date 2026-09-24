// Description:
//   Assign roles to people you're chatting with
//
// Commands:
//   hubot <user> is a badass guitarist - assign a role to a user
//   hubot <user> is not a badass guitarist - remove a role from a user
//   hubot who is <user> - see what roles a user has
//
// Examples:
//   hubot holman is an ego surfer
//   hubot holman is not an ego surfer

import type { Robot, User } from "./runtime/types";

function getAmbiguousUserText(users: User[]): string {
  return `Be more specific, I know ${users.length} people named like that: ${users.map((u) => u.name).join(', ')}`;
}

export = (robot: Robot): void => {
  if (process.env.HUBOT_AUTH_ADMIN) {
    robot.logger.warning('The HUBOT_AUTH_ADMIN environment variable is set not going to load roles script, you should delete it');
    return;
  }

  robot.respond(/who is @?([\w .\-]+)\?*$/i, (msg) => {
    let joiner = ', ';
    const name = msg.match[1].trim();

    if (name === 'you') {
      msg.send("Who ain't I?");
    } else if (name === robot.name) {
      msg.send('The best.');
    } else {
      const users = robot.brain.usersForFuzzyName(name);
      if (users.length === 1) {
        const user = users[0];
        user.roles = user.roles || [];
        if (user.roles.length > 0) {
          if (user.roles.join('').search(',') > -1) {
            joiner = '; ';
          }
          msg.send(`${name} is ${user.roles.join(joiner)}.`);
        } else {
          msg.send(`${name} is nothing to me.`);
        }
      } else if (users.length > 1) {
        msg.send(getAmbiguousUserText(users));
      } else {
        msg.send(`${name}? Never heard of 'em`);
      }
    }
  });

  robot.respond(/@?([\w .\-_]+) is (["'\w: \-_]+)[.!]*$/i, (msg) => {
    const name = msg.match[1].trim();
    const newRole = msg.match[2].trim();

    if (!['', 'who', 'what', 'where', 'when', 'why', 'lab'].includes(name)) {
      if (!newRole.match(/^not\s+/i)) {
        const users = robot.brain.usersForFuzzyName(name);
        if (users.length === 1) {
          const user = users[0];
          user.roles = user.roles || [];

          if (user.roles.includes(newRole)) {
            msg.send('I know');
          } else {
            user.roles.push(newRole);
            if (name.toLowerCase() === robot.name.toLowerCase()) {
              msg.send(`Ok, I am ${newRole}.`);
            } else {
              msg.send(`Ok, ${name} is ${newRole}.`);
            }
          }
        } else if (users.length > 1) {
          msg.send(getAmbiguousUserText(users));
        } else {
          msg.send(`I don't know anything about ${name}.`);
        }
      }
    }
  });

  robot.respond(/@?([\w .\-_]+) is not (["'\w: \-_]+)[.!]*$/i, (msg) => {
    const name = msg.match[1].trim();
    const newRole = msg.match[2].trim();

    if (!['', 'who', 'what', 'where', 'when', 'why', 'lab'].includes(name)) {
      const users = robot.brain.usersForFuzzyName(name);
      if (users.length === 1) {
        const user = users[0];
        user.roles = user.roles || [];
        if (msg.envelope.user?.name === user.name) {
          msg.send('Nice try, dumbass!');
        } else if (!user.roles.includes(newRole)) {
          msg.send('I know.');
        } else {
          user.roles = user.roles.filter((role: string) => role !== newRole);
          msg.send(`Ok, ${name} is no longer ${newRole}.`);
        }
      } else if (users.length > 1) {
        msg.send(getAmbiguousUserText(users));
      } else {
        msg.send(`I don't know anything about ${name}.`);
      }
    }
  });
};

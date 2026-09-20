// Description:
//   partychat like chat-score/leaderboard script built at 'SDSLabs'
//   we developed this to use in our 'Slack' team instance
//
// Commands:
//   listen for * has/have keys in chat text and displays users with the keys/updates the user having keys
//   bot who has keys : returns current user having lab keys
//   bot i have keys : set's the key-holder to the user who posted
//   bot i dont have keys : unsets the user who posted from key-holders
//   bot xyz has keys : sets xyz as the holder of keys
//
// Examples:
//   :bot who has keys
//   :bot i have keys
//   :bot i dont have keys
//   :bot who has keys
//   :bot ravi has keys

import type { Robot, User } from "./runtime/types";

interface KeyEntry {
  holder: string;
  owner: string;
}

function getAmbiguousUserText(users: User[]): string {
  return `Be more specific, I know ${users.length} people named like that: ${users.map((u) => u.name).join(", ")}`;
}

export = (robot: Robot): void => {
  const key = (): KeyEntry[] => {
    const k = robot.brain.get("key") || [];
    robot.brain.set("key", k);
    return k;
  };

  robot.respond(/i have (a key|the key|key|keys) of (.+)/i, (msg) => {
    const name = msg.message.user.name;
    const ownerName = msg.match[2];
    const user = robot.brain.userForName(name);
    try {
      const kh = key();
      /* BUGFIX: the CoffeeScript used `typeof user is 'object'`, which is
         also true for null. A real existence check preserves the intent
         (sender is always a known user, so behavior is unchanged in
         practice) without treating a failed lookup as success. */
      if (user != null) {
        msg.send(`Okay ${name} has keys`);
        kh.push({ holder: name, owner: ownerName });
      }
      robot.brain.set("key", kh);
    } catch (e) {
      console.log(e);
    }
  });

  robot.respond(
    /i (don\'t|dont|do not) (has|have) (the key|key|keys|a key)/i,
    (msg) => {
      const name = msg.message.user.name;
      const user = robot.brain.userForName(name);
      const kh = key();
      let check = 0;
      // Iterate over a snapshot because matching entries are removed from kh.
      // Iterating kh directly skips adjacent entries after splice().
      for (const x of [...kh]) {
        if (x.holder === name) {
          const index = kh.indexOf(x);
          const owner = x.owner;
          kh.splice(index, 1);
          check = 1;
          msg.send(
            `Okay ${name} doesn't have keys.Then, Who got the keys of ${owner}?`,
          );
        }
      }
      /* NOTE: the original CoffeeScript referenced an undeclared `user`
         here, so `typeof user is 'object'` was always false and this
         message was unreachable dead code. The lookup below revives it
         as clearly intended; the null check keeps it honest. */
      if (user != null) {
        if (check === 0) {
          msg.send("Yes , i know buddy");
        }
      }
      robot.brain.set("key", kh);
    },
  );

  robot.respond(/(.+) (has|have) (the key|key|keys|a key) of (.+)/i, (msg) => {
    const othername = msg.match[1];
    const ownerName = msg.match[4];
    const name = msg.message.user.name;
    const k = key();
    if (ownerName === "") {
      msg.send("okay, but whose key");
    } else {
      if (
        ![
          "who",
          "who all",
          "Who",
          "Who all",
          "i",
          "I",
          "i don't",
          "i dont",
          "i do not",
          "I don't",
          "I dont",
          "I do not",
        ].includes(othername)
      ) {
        if (othername === "you") {
          msg.send(`How am I supposed to take those keys? ${name} is a liar!`);
        } else if (othername === robot.name) {
          msg.send(`How am I supposed to take those keys? ${name} is a liar!`);
        } else {
          const users = robot.brain.usersForFuzzyName(othername);
          const userso = robot.brain.usersForFuzzyName(ownerName);
          if (users.length === 1) {
            if (userso.length === 1) {
              k.push({ holder: users[0].name, owner: userso[0].name });
              robot.brain.set("key", k);
              msg.send(
                `Okay, so now the key of ${userso[0].name} are with ${users[0].name}`,
              );
            } else if (userso.length > 1) {
              /* BUGFIX: the CoffeeScript tested `users.length > 1` here
                 (dead code inside the `users.length is 1` arm). The TS
                 port corrected the condition to `userso.length > 1` but
                 originally still passed `users`; the ambiguous list must
                 be the OWNER candidates (`userso`). */
              msg.send(getAmbiguousUserText(userso));
            } else {
              msg.send(`${ownerName}? Never heard of 'em`);
            }
          } else if (users.length > 1) {
            msg.send(getAmbiguousUserText(users));
          } else {
            msg.send(`${othername}? Never heard of 'em`);
          }
        }
      }
    }
  });

  robot.respond(
    /(i|I) (have given|gave|had given) (the key|key|keys|a key|the keys) to (.+)/i,
    (msg) => {
      const othername = msg.match[4];
      const name = msg.message.user.name;
      const k = key();
      if (othername === "you") {
        msg.send(
          "That's utter lies! How can you blame a bot to have the keys?",
        );
      } else if (othername === robot.name) {
        msg.send(
          "That's utter lies! How can you blame a bot to have the keys?",
        );
      } else {
        const users = robot.brain.usersForFuzzyName(othername);
        if (users.length === 0) {
          msg.send(`I don't know anyone by the name ${othername}`);
        } else {
          let check = 0;
          for (const x of k) {
            if (x.holder === name) {
              x.holder = users[0].name;
              msg.send(
                `Okay, so now the keys of ${x.owner} are with ${users[0].name}`,
              );
              check = 1;
            }
          }
          if (check === 0) {
            msg.send("Liar, you don't have the keys");
          }
        }
      }
      robot.brain.set("key", k);
    },
  );

  robot.respond(/(who|who all) (has|have) (the key|key|keys|a key)/i, (msg) => {
    try {
      const kh = key();
      /* BUGFIX: original CoffeeScript compared `kh is []` — a fresh array
       literal is never reference-equal to anything, so that branch was
       always false and this dead-code path never ran (the `msgText === ""`
       check further down happened to catch the empty case anyway, so this
       was inert rather than user-visible, but it's fixed here to do what
       it clearly was meant to do).*/
      if (kh.length === 0) {
        msg.send(
          "Ah! Nobody informed me about the keys. Don't hold me responsible for this :expressionless:",
        );
      } else {
        const list: string[] = [];
        for (const x of kh) {
          list.push(`${x.owner}'s key are with ${x.holder}`);
        }
        let msgText = list.join("\n");
        if (msgText === "") {
          msg.send(
            "Ah! Nobody informed me about the keys. Don't hold me responsible for this :expressionless:",
          );
        } else {
          msg.send(msgText);
        }
        robot.brain.set("key", kh);
      }
    } catch (e) {
      console.log(e);
    }
  });

  robot.respond(/who (has|have) (.+'s) (key|keys)/i, (msg) => {
    let ownerName = msg.match[2];
    ownerName = ownerName.substr(0, ownerName.length - 2);
    const users = robot.brain.usersForFuzzyName(ownerName);
    try {
      const kh = key();
      if (users.length === 1) {
        let s = "";
        for (const x of kh) {
          if (x.owner === users[0].name) {
            s = `${x.owner} keys are with ${x.holder}`;
          }
        }
        if (s === "") {
          msg.send("Ah! Nobody informed me about the keys.");
        } else {
          msg.send(s);
        }
      } else if (users.length > 1) {
        msg.send(getAmbiguousUserText(users));
      } else {
        msg.send(`${ownerName}? Never heard of 'em`);
      }
      robot.brain.set("key", kh);
    } catch (e) {
      console.log(e);
    }
  });
};

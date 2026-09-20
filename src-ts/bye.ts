// Description:
//   GOOD Night
//
// Dependencies:
//   None
//
// Configuration:
//   None
//
// Commands:
//   good night

import type { Robot } from "./runtime/types";

const waysToSayGoodNight = [
  "Good night, baby.",
  "Night hot stuff.",
  "Like I'm going to let you get any sleep",
  "LOOK...the moon is calling you, SEE...the stars are shining for you, HEAR... my heart saying good night.",
  "Sleep tight, don't let the bed bugs bite",
  "I'll be here, all alone, waiting",
  "So long, and thanks for all the fish.",
  "Finally",
  "À voir!",
  "Don't let the back door hit ya where the good Lord split ya",
  "May your feet never fall off and grow back as cactuses",
  "TTYL",
  "C U L8R",
  "Fine, then go!",
  "Cheers",
  "Uh, I can hear the voices calling me...see ya",
  "In a while, crocodile",
  "SHOO! SHOO!",
  "No more of you.",
  "Avada Kedavra",
  "Ok. Tata. Byebye",
  "Connection: close",
  "End Of Line",
  "Farewell! God knows when we shall meet again.",
  "You are the weakest link - goodbye!",
  "आप  इस  राउंड  के  कमज़ोर  कड़ी  हैं. आप जा सकते हैं. नमस्ते",
  "If I leave here tomorrow, will you still remember me?",
  "Don't leave me here!",
  "If you say so.",
  "Connection closed by remote host",
  "You are fired.",
];

export = (robot: Robot): void => {
  robot.hear(/(good night|goodnight|cya|bye|nighty night)/i, (msg) => {
    msg.send(msg.random(waysToSayGoodNight));
  });
};

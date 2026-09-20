// Description:
//   Interacts with the Google Maps API.
//
// Commands:
//   hubot map me <query> - Returns a map view of the area returned by `query`.

import type { Robot } from "./runtime/types";

export = (robot: Robot): void => {
  robot.respond(/(?:(satellite|terrain|hybrid)[- ])?map me (.+)/i, (msg) => {
    const mapType = msg.match[1] || "roadmap";
    const location = msg.match[2];
    const mapUrl =
      "http://maps.google.com/maps/api/staticmap?markers=" +
      encodeURIComponent(location) +
      "&size=400x400&maptype=" +
      mapType +
      "&sensor=false" +
      "&format=png"; // So campfire knows it's an image
    const url =
      "http://maps.google.com/maps?q=" +
      encodeURIComponent(location) +
      "&hl=en&sll=37.0625,-95.677068&sspn=73.579623,100.371094&vpsrc=0&hnear=" +
      encodeURIComponent(location) +
      "&t=m&z=11";

    msg.send(mapUrl);
    msg.send(url);
  });
};

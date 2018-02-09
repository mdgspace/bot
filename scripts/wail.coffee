# Description:
#   Returns the names of people in lab
# 
# Dependencies:
#   None
#
# Configuration:
#   WAIL_PIC_URL
#
# Commands:
#   hubot who all in lab
#
# Author:
#   csoni111

module.exports = (robot) ->
    robot.respond /who.*lab/i, (msg) ->
        waliUrl = process.env.WAIL_PIC_URL + '?t=' + new Date().getTime()
        wailTextUrl = process.env.WAIL_NAME_URL + '?t=' + new Date().getTime()
        
        request = require 'request'

        resp = ""
        request.get {uri:'#{wailTextUrl}'}, (err, r, body) ->
            resp = body

        msg.send(
            "attachments": [
            "fallback": "Here's a pic: #{waliUrl}"
            "color": "#36a64f"
            "pretext": "#{resp} \n Here's a pic:"
            "image_url": waliUrl
            "ts": new Date().getTime() / 1000
            ]
        )

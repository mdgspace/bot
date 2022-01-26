# Description:
#   Returns the names of people in lab
#
# Dependencies:
#   None
#
# Configuration:
#   WAIL_PIC_URL, WAIL_NAME_URL
#
# Commands:
#   hubot who all in lab
#
# Author:
#   csoni111

module.exports = (robot) ->
  robot.respond /who.*lab/i, (msg) ->
    wailUrl = process.env.WAIL_PIC_URL + '?t=' + new Date().getTime()
    wailTextUrl = process.env.WAIL_NAME_URL + '?t=' + new Date().getTime()
    resp = ""
    robot.http('#{wailTextUrl}')
    .get() (err,response,body) ->
      resp = body
      error = err
      msg.send("attachments": [
          "fallback": "#{error} \n Here's a pic: #{wailUrl}"
          "color": "#36a64f"
          "pretext": "#{resp} \n Here's a pic:"
          "image_url": wailUrl
          "ts": new Date().getTime() / 1000
          ]
      )

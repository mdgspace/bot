# Description:
# Checks if there are no messages for a fixed time and sends random posts from ToDJ.
# 
# Dependencies:
#   None
#
# Configuration:
#   IDLE_TIME_DURATION_HOURS
#
# Commands:
#   None
#
# Author:
#   csoni111

set_time = parseFloat process.env.IDLE_TIME_DURATION_HOURS or "0"
i=0
msec_per_hour = 1000*60*60
last_msg_time = null
idle_msgs = [
  'Why so silent?',
  'Is anyone alive :expressionless:',
  'Looks like I am all alone!',
]

module.exports = (robot) ->
    if set_time > 0
        robot.hear /.+/i, (msg) ->
            last_msg_time = new Date()
            if i
                clearInterval i
            i=setInterval () ->
                checkAndSendMsg()
            , msec_per_hour*set_time

    checkAndSendMsg = ->
        idle_time_hour = ((new Date()).getTime() - last_msg_time.getTime())/msec_per_hour
        if idle_time_hour > set_time
            robot.emit 'send:fb-feed', 'dardanaak'
# Description:
# Checks if there are no messages for a fixed time and send random responses.
# 
# Dependencies:
#   None
#
# Configuration:
#   set IDLE_TIME_DURATION_HOURS as environment variable
#
# Commands:
#   
#
# Author:
#   csoni111

set_time = process.env.IDLE_TIME_DURATION_HOURS or "0"
set_time = parseFloat set_time
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
    		robot.send room: 'general', idle_msgs[Math.floor idle_msgs.length*Math.random()]
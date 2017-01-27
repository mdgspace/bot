# Description:
# Checks if there are no messages for a fixed time and sends random responses.
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

last_msg_time = null
idle_msgs = [
  'Why so silent?',
  'Is anyone alive :expressionless:',
  'Looks like I am all alone!',
]

cron = require('node-cron')

if (IDLE_TIME_DURATION_HOURS = process.env.IDLE_TIME_DURATION_HOURS)
    cron.schedule '0 0 */'+IDLE_TIME_DURATION_HOURS+' * * *', ()->
    	elapsed_hour = ((new Date()).getTime() - last_msg_time.getTime())/(1000*60*60)
    	if elapsed_time < IDLE_TIME_DURATION_HOURS
          robot.send room: 'general', idle_msgs[Math.floor(idle_msgs.length*Math.random)]

module.exports = (robot) ->
	robot.hear /.+/i, (msg) ->
		last_msg_time = new Date()
# Dependencies:
#   None
#
# Configuration:
#   https://github.com/github/hubot/blob/master/docs/scripting.md#middleware
#
# Author:
#   csoni111

module.exports = (robot) ->
	BLACKLISTED_USERS = [
  	# Restrict access for a user ID
	]

	robot.receiveMiddleware (context, next, done) ->
  		if context.response.message.user.id in BLACKLISTED_USERS
    		# Don't process this message further.
    		context.response.message.finish()

    		# If the message starts with 'hubot' or the alias pattern, this user was
    		# explicitly trying to run a command, so respond with an error message.
    		if context.response.message.text?.match(robot.respondPattern(''))
      			context.response.reply "I'm sorry @#{context.response.message.user.name}, but I'm configured to ignore your commands."
    			
    		# Don't process further middleware.
    		done()
  		else
    		next(done)
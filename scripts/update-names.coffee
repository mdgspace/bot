# Desciption:
#   Script for updating names database
#
# Commands:
#   hubot update db
https = require 'https'
token = process.env.SLACK_API_TOKEN
parsedUsers=0
updatedUsers=0
totalUsers=0
currentRoom=null

module.exports = (robot) ->
  if token
    robot.respond /update db/i, (msg) ->
      msg.send "Updating names in database"
      currentRoom = msg.message.user.room
      parsedUsers=0
      updatedUsers=0
      totalUsers=Object.keys(robot.brain.data.users).length
      for own key, user of robot.brain.data.users
        updateName user.id

    updateName = (uid) ->
      pre = '/api/users.info?token='
      post = '&user='
      url = pre+token+post+uid
      req = https.get { host: 'slack.com', path: url }, (res) ->
        res.on 'data', (chunk) ->
          parsedUsers++
          data = JSON.parse('' + chunk)
          if data.ok
            user = robot.brain.userForId data.user.id
            if user.name isnt data.user.name
              user.name = data.user.name
              updatedUsers++
          if parsedUsers==totalUsers
            robot.send room: currentRoom, "Updated names for #{updatedUsers} out of #{totalUsers} users"
          
  else
    console.log "No slack Api token found"

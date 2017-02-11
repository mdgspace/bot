# Desciption:
#   Script for updating names database
#
# Commands:
#   hubot update db
http = require 'https'
token = process.env.SLACK_API_TOKEN

module.exports = (robot) ->
  if token
    robot.respond /update db/i, (msg) ->
      msg.send "Updating name database"
      for own key, user of robot.brain.data.users
        updateName(user.id)
  else
    console.log "No slack Api token found"

  updateName = (uid) ->
    pre = '/api/users.info?token='
    token = 
    post = '&user='
    url = pre+token+post+uid
    req = http.get { host: 'slack.com', path: url }, (res) ->
      res.on 'data', (chunk) ->
        data = JSON.parse('' + chunk)
        user = robot.brain.userForId data.user.id
        user.name = data.user.name

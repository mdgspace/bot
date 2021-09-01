https = require('follow-redirects').https

# Get the user details
exports.info = (callback) ->
  output = ''
  https.get process.env.INFO_SPREADSHEET_URL + "?output=csv", (res) ->
    res.on 'data', (body) ->
      output += body
    res.on 'end', () ->
      callback output
    res.on 'error', (err) ->
      callback err

exports.parse = (json, callback) ->
  result = []
  for line in json.toString().split '\n'
    result.push line.split(',').map Function.prototype.call,
    String.prototype.trim
  if result != ""
    callback result
  else
    callback false

# obtaining the current date to calculate relative_year
exports.year = (batch, callback) ->
  today = new Date
  mm = today.getMonth() + 1
  yyyy = today.getFullYear()
  yy = yyyy % 100
  if mm < 7
    relative_year = yy
  else
    relative_year = yy + 1
  relative_year -= batch
  callback relative_year

exports.member = (members, year, callback) ->
  user_name = []
  slackId = []
  for user in members
    if (user.length >= 13)
      user_year = user[4].split('')
      year_info = parseInt(user_year[0], 10 )
      if year == year_info
          if user[10]
            slackId.push [user[10]]
            user_name.push user[0]
  callback [user_name, slackId]

exports.scorefield = (robot, callback) ->
    Field = robot.brain.get("scorefield") or {}
    robot.brain.set("scorefield", Field)
    callback Field
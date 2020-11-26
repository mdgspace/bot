# Description:
#   Script for batch wise score.
#
# Configuration:
#   INFO_SPREADSHEET_URL
#
# Commands:
#   hubot score bxx
#
# Author:
#   aseem09

util = require('./util')

module.exports = (robot) ->

  scorefield = () ->
    Field = robot.brain.get("scorefield") or {}
    robot.brain.set("scorefield", Field)
    Field

  stringLength = (str) ->
    return String(str).split('').length

  # makes all the elements in the array equal in width by padding at right
  padright = (array) ->
    padding = 0
    max_length = 0
    for name in array
      max_length = if max_length >= stringLength(name)
      then max_length
      else stringLength(name)
    padding = max_length
    for i in [0..array.length - 1]
      max = padding - stringLength(array[i])
      if i == 0
        max = max + 3
      if max > 0
        for j in [0..max - 1]
          array[i] += " "
    return array

  # makes all the elements in the array equal in width by padding at left
  padleft = (array) ->
    padding = 5
    for i in [0..array.length - 1]
      max = padding - stringLength(array[i])
      name = ""
      if max>0
        for j in [0..max - 1]
          name += " "
      name += array[i]
      array[i] = name
    return array

  parse = (json) ->
    result = []
    for line in json.toString().split '\n'
      result.push line.split(',').map Function.prototype.call,
      String.prototype.trim
    if result != ""
      result
    else
      false

  robot.respond /score f(\d\d)/i, (msg) ->

    ScoreField = scorefield()

    # obtaining the current date to calculate relative_year
    today = new Date
    mm = today.getMonth() + 1
    yyyy = today.getFullYear()
    yy = `yyyy % 100`
    if `mm < 7`
      `relative_year = yy`
    else
      `relative_year = yy + 1`

    # <batch> whose score is to be shown
    batch = msg.match[1]
    year = relative_year - batch

    util.info (body) ->
      result = []
      result = parse body
      user_name = []
      user_name.push ["```Name"]
      slackId = []
      slackId.push ["Score"]
      for user in result
        if (user.length >= 13)
          user_year = user[4].split('')
          year_info = parseInt(user_year[0], 10 );
          if `year_info == year`
            if user[10]
              slackId.push [user[10]]
              user_name.push [user[0]]

      user_score = []

      for i in [1..slackId.length - 1]
        user_score[i] = ScoreField[slackId[i]] or 0

      user_name = padright user_name
      user_score = padleft user_score

      sorted = []
      sorted.push [user_name[0], slackId[0]]
      for i in [1..user_name.length - 1]
        sorted.push [user_name[i], user_score[i]]

      if sorted.length
        sorted.sort (a, b) ->
          b[1] - a[1]

      sorted = sorted.map (val) -> "#{val[0]} : #{val[1]}"
      response = []
      response += sorted.join '\n'
      response += "```"
      msg.send response

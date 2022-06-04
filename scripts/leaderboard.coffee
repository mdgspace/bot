# Description:
#   Script for maininting scores of different users.
#
# Commands:
#   name++ or name-- : Adds/subtracts 1 point to/from user's score
#   hubot score name : Shows current score of the user

util = require('./util')

module.exports = (robot) ->

  robot.listenerMiddleware (context, next, done) ->

    try
      # Check if it was called in a room.
      if get_channel(context.response) is '#DM'
        context.response.reply "This won't work here"
        # Skipping sending the message to general channel.
        # robot.send room: 'general', "@#{context.response.message.user.name} pls dont DM me. Talk here in public!"
        # Bypass executing the listener callback
        done()
      else
        next (done)
    catch err
      robot.emit('error', err, context.response)

  get_channel = (response) ->
    if response.message.room == response.message.user.name
      "@#{response.message.room}"
    else
      isDM = response.message.room[0] is 'D'
      messageType = 'unknown'
      if isDM
        messageType = 'DM'
      "##{messageType}"

  # returns list of skipped words
  skippedlist = () ->
    List = robot.brain.get("skippedlist") or []
    robot.brain.set("skippedlist", List)
    List

  # return object to store data for all keywords
  # using this, stores the data in brain's "scorefield" key
  scorefield = () ->
    Field = robot.brain.get("scorefield") or {}
    robot.brain.set("scorefield", Field)
    Field

  detailedfield = () ->
    Field = robot.brain.get("detailedfield") or {}
    robot.brain.set("detailedfield", Field)
    Field
  # returns last score
  lastScore = (name, field) ->
    name = name.toLowerCase()
    lastscore = field[name] or 0
    lastscore

  #returns appreciation field associated to a single user
  userFieldMinus = (user) ->
    Detailedfield = detailedfield()
    Detailedfield[user] = Detailedfield[user] or {}
    Detailedfield[user]["minus"] = Detailedfield[user]["minus"] or {}
    Detailedfield[user]["minus"]

  #returns depreciation field associated to a single user
  userFieldPlus = (user) ->
    Detailedfield = detailedfield()
    Detailedfield[user] = Detailedfield[user] or {}
    Detailedfield[user]["plus"] = Detailedfield[user]["plus"] or {}
    Detailedfield[user]["plus"]

  #updates detailed field
  updateDetailedScore = (field, sendername, fieldtype) ->
    if(fieldtype == "plus")
      field[sendername] = field[sendername] + 1 or 1
    else
      field[sendername] = field[sendername] + 1 or 1

  # updates score according to ++/--
  updateScore = (word, field, username, slackIds) ->
    posRegex = /\+\+/
    negRegex = /\-\-/

    # if there is to be `plus` in score
    if word.indexOf("++") >= 0
      name = word.replace posRegex, ""
      if username.toLowerCase() == name.toLowerCase()
        response = "-1"
      else if name in slackIds
        field[name.toLowerCase()] = lastScore(name, field) + 1
        userfield = userFieldPlus(name.toLowerCase())
        updateDetailedScore(userfield, username, "plus")
        response = responses[Math.floor(Math.random() * 7)]
      else
        response = "0"

    # if there is to be `minus` in score
    else if word.indexOf("--") >= 0
      name = word.replace negRegex, ""
      if username.toLowerCase() == name.toLowerCase()
        response = "-1"
      else if name in slackIds
        field[name.toLowerCase()] = lastScore(name, field) - 1
        userfield = userFieldMinus(name.toLowerCase())
        updateDetailedScore(userfield, username, "minus")
        response = "ouch!"
      else
        response = "0"

    newscore = field[name.toLowerCase()]

    # returns 'name' and 'newscore' and 'response'
    New: newscore
    Name: name
    Response: response

  getSlackIds = (callback) ->
    util.info (body) ->
      slackIds = []
      for user in parse body
        if user.length >= 13 and user[10]?
          slackIds.push user[10]
      callback slackIds

  parse = (json) ->
    result = []
    for line in json.toString().split '\n'
      result.push line.split(',').map Function.prototype.call,
      String.prototype.trim
    if result != ""
      result
    else
      false

  # listen for any [word](++/--) in chat and react/update score
  robot.hear /[a-zA-Z0-9\-_]+(\-\-|\+\+)/gi, (msg) ->

    # message for score update that bot will return
    oldmsg = msg.message.text

    # data-store object
    ScoreField = scorefield()

    # skipped word list
    SkippedList = skippedlist()

    # index keeping an eye on position, where next replace will be
    start = 0
    end = 0

    # reply only when there exist altest one testword which
    # is neither skipped nor its length greater than 30
    reply = false
    
    getSlackIds (slackIds) ->
      # for each ++/--
      for i in [0...msg.match.length]
        testword = msg.match[i]

        end = start + testword.length
        
        # check if testword is already skipped or it is too lengthy
        if testword.slice(0, -2) in SkippedList or testword.length > 30
          newmsg = ""

        else
          reply = true
          # updates Scoring for words, accordingly and returns result string
          result = updateScore(testword, ScoreField, msg.message.user.name, slackIds)

          # generates response message for reply
          if result.Response == "-1"
            newmsg = "#{testword} [Sorry, You can't give ++ or -- to yourself.]"
          else if result.Response == "0"
            newmsg = "#{result.Name}? Never heard of 'em "
          else
            newmsg = "#{testword} [#{result.Response} #{result.Name} now at #{result.New}] "

        oldmsg = oldmsg.substr(0, start) + newmsg + oldmsg.substr(end + 1)
        start += newmsg.length

      if reply
        # reply with updated message
        msg.send "#{oldmsg}"


  # response for score status of any <keyword>
  robot.respond /score ([\w\-_]+)/i, (msg) ->

    # we do not want to reply in case of batch score is requested
    fxx = /f\d\d/i
    if fxx.exec(msg.match[0]) != null
    then return

    # data-store object
    ScoreField = scorefield()

    # <keyword> whose score is to be shown
    name = msg.match[1]
    name = name.toLowerCase()

    # If the key exist
    if ScoreField[name]?
      # current score for keyword
      currentscore = ScoreField[name]
      msg.send "#{name} : #{currentscore}"
    
    else
      msg.send "#{name}? Never heard of 'em"

  robot.on 'plusplus', (event) ->
    ScoreField = scorefield()
    result = updateScore("#{event.username}++", ScoreField, "Shell", [event.username])
    newmsg = "#{event.username}++ [#{result.Response} #{result.Name} now at #{result.New}]"
    robot.send room: 'general', newmsg

responses = [
  'flamboyant!'
  'baroque!'
  'impressive!'
  'lustrous!'
  'splashy!'
  'superb!'
  'splendid!'
]

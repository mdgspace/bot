# Description:
#   Script for maininting scores of different users.
#
# Commands:
#   name++ or name-- : Adds/subtracts 1 point to/from user's score
#   hubot score name : Shows current score of the user

module.exports = (robot) ->

  robot.listenerMiddleware (context, next, done) ->
    
    try
      # Check if it was called in a room.
      if get_channel(context.response) is '#DM'
        context.response.reply "This won't work here"
        robot.send room: 'general', "@#{context.response.message.user.name} pls dont DM me. Talk here in public!"
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
      "##{robot.adapter.client.rtm.dataStore.getChannelGroupOrDMById(response.message.room).name}"
 
  # return object to store data for all keywords
  # using this, stores the data in brain's "scorefield" key
  scorefield = () ->
    Field = robot.brain.get("scorefield") or {}
    robot.brain.set("scorefield",Field)
    Field
  
  detailedfield= () ->
    Field = robot.brain.get("detailedfield") or {}
    robot.brain.set("detailedfield",Field)
    Field
  # returns last score
  lastScore = (name, field) ->
    name = name.toLowerCase()
    lastscore = field[name] or 0
    lastscore
 
  #returns appreciation field associated to a single user
  userFieldMinus = (user) ->
    Detailedfield= detailedfield()
    Detailedfield[user] = Detailedfield[user] or {}
    Detailedfield[user]["minus"] = Detailedfield[user]["minus"] or {}
    Detailedfield[user]["minus"]

  #returns depreciation field associated to a single user
  userFieldPlus = (user) ->
    Detailedfield= detailedfield()
    Detailedfield[user] = Detailedfield[user] or {}
    Detailedfield[user]["plus"] = Detailedfield[user]["plus"] or {}
    Detailedfield[user]["plus"]

  #updates detailed field
  updateDetailedScore = (field , sendername , fieldtype)->
    if(fieldtype == "plus")
      field[sendername]=field[sendername]+1 or 1
    else
      field[sendername]=field[sendername]+1 or 1

  # updates score according to ++/--
  updateScore = (word, field, username) ->
    posRegex = /\+\+/
    negRegex = /\-\-/
    names = Object.keys(robot.brain.data.users)

    # if there is to be `plus` in score
    if word.indexOf("++") >= 0
      name = word.replace posRegex, ""
      unless username.toLowerCase() in names
        response = "-2"
      else if username.toLowerCase() == name.toLowerCase()
        response = "-1"
      else
        field[name.toLowerCase()] = lastScore(name, field) + 1
        userfield= userFieldPlus(name.toLowerCase())
        updateDetailedScore(userfield,username,"plus")
        response= responses[Math.floor(Math.random() * 7)]
 
    # if there is to be `minus` in score
    else if word.indexOf("--") >= 0
      name = word.replace negRegex, ""
      unless username.toLowerCase() in names
        response = "-2"
      else if username.toLowerCase() == name.toLowerCase()
        response = "-1"
      else
        field[name.toLowerCase()] = lastScore(name, field) - 1
        userfield= userFieldMinus(name.toLowerCase())
        updateDetailedScore(userfield,username,"minus")
        response= "ouch!"
 
    newscore = field[name.toLowerCase()]
 
    # returns 'name' and 'newscore' and 'response'
    New: newscore
    Name: name
    Response: response
 
 
  # listen for any [word](++/--) in chat and react/update score
  robot.hear /[a-zA-Z0-9\-_]+(\-\-|\+\+)/gi, (msg) ->
 
    # message for score update that bot will return
    oldmsg = msg.message.text
 
    # data-store object
    ScoreField = scorefield()
 
    # index keeping an eye on position, where next replace will be
    start = 0
    end = 0
    shouldSend = true
 
    # for each ++/--
    for i in [0...msg.match.length]
      testword = msg.match[i]
 
      # updates Scoring for words, accordingly and returns result string
      result = updateScore(testword, ScoreField, msg.message.user.name)
      

      end = start + testword.length
 
      # generates response message for reply
      if result.Response == "-2"
        if result.Name.toLowerCase() isnt "c"
          newmsg = "#{testword} [Sorry, I don't know anything about #{result.Name}.]"
        else
          shouldSend = false # Do not reply if c++ is encountered
      else if result.Response == "-1"
        newmsg = "#{testword} [Sorry, You can't give ++ or -- to yourself.]"
      else
        newmsg = "#{testword} [#{result.Response} #{result.Name} now at #{result.New}] "
      if result.Name.toLowerCase() isnt "c"
      	oldmsg = oldmsg.substr(0, start) + newmsg + oldmsg.substr(end+1)
      	start += newmsg.length
 
    # reply with updated message
    if shouldSend
      msg.send "#{oldmsg}"
 
 
  # response for score status of any <keyword>
  robot.respond /score ([\w\-_]+)/i, (msg) ->
 
    # data-store object
    ScoreField = scorefield()
 
    # <keyword> whose score is to be shown
    name = msg.match[1]
    name = name.toLowerCase()
 
    # current score for keyword
    ScoreField[name] = ScoreField[name] or 0
    currentscore = ScoreField[name]
 
    msg.send "#{name} : #{currentscore}"

  robot.on 'plusplus', (event) ->
    ScoreField = scorefield()
    result = updateScore("#{event.username}++", ScoreField, "Shell")
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
# Description:
#   Script for batch wise score.
#
# Configuration:
#   INFO_SPREADSHEET_URL
#
# Commands:
#   hubot score fxx -> for tabular representation
#   hubot score fxx -b -> for bar graph
#   hubot score fxx -p -> for pie graph
#
# Author:
#   aseem09, aman-singh7

util = require('./util')

module.exports = (robot) ->

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

  ###*
  # updates score of whole batch according to ++/--
  # @param {number} year: Year of the batch whose score is to be updated
  # @param {string} type: '++' for increasing score and '--' for decreasing score
  # @param {object} field: The scorefield object which needs to be updated
  # @param {string} username: Slack-Id of the user who triggered the event
  # @return {object}: Tells about the status of score change and number of people whose score has changed
  ###
  updateBatchScore = (year, type, field, username) ->
    same = false;
    batch_exists = true;
    util.info (body) ->
      result = []
      result = parse body
      member result, year, (slackId) ->
        if slackId.length==0
          batch_exists = false;
        for i in [0..slackId.length]
          if username.toLowerCase() == slackId.toLowerCase()
            same = true;
        if same
          response = "-1"
          length = 0
        else if !batch_exists
          response = "0"
          length = 0
        else if type == "++"
          response = responses[Math.floor(Math.random() * 7)]
          length = slackId.length
          for i in [0..slackId.length]
            field[slackId.toLowerCase()] = lastScore(slackId, field) + 1
            userfield = userFieldPlus(slackId.toLowerCase())
            updateDetailedScore(userfield, username, "plus")
        else if type == "--"
          response = "ouch!"
          length = slackId.length
          for i in [0..slackId.length]
            field[slackId.toLowerCase()] = lastScore(slackId, field) - 1
            userfield = userFieldMinus(slackId.toLowerCase())
            updateDetailedScore(userfield, username, "minus")
    
    Response : response
    Length : length

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
      if max > 0
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

  member = (members, year, callback) ->
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

  robot.hear /f(\d\d)+(\-\-|\+\+)/gi, (msg) ->

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
    
    # obtaining the current date to calculate relative_year
    today = new Date
    mm = today.getMonth() + 1
    yyyy = today.getFullYear()
    yy = yyyy % 100
    if mm < 7
      relative_year = yy
    else
      relative_year = yy + 1

    for i in [0...msg.match.length]
      testword = msg.match[i]

      end = start + testword.length

      if testword.slice(0, -2) in SkippedList or testword.length > 30
          newmsg = ""
      else
         reply = true

         # <batch> whose score is to be shown
         batch = testword.slice(1,-2)
         year = relative_year - batch

         # ++ or --
         type = testword.slice(-2)

         result = updateBatchScore(year,type,ScoreField,msg.message.user.name)

         if result.Response == "-1"
           newmsg = "#{testword} [Sorry, You can't give ++ or -- to your own batch.] "
         else if result.Response == "0"
           newmsg = "f#{year}? I don't know anyone from this year."
         else
           newmsg = "#{testword} [#{result.Response} Gave #{type} to #{result.Length} people from year 20#{year}] "

      oldmsg = oldmsg.substr(0, start) + newmsg + oldmsg.substr(end + 1)
      start += newmsg.length

    if reply
        # reply with updated message
        msg.send "#{oldmsg}"


  robot.respond /score f(\d\d)( \-\w)?/i, (msg) ->
    
    ScoreField = scorefield()

    # obtaining the current date to calculate relative_year
    today = new Date
    mm = today.getMonth() + 1
    yyyy = today.getFullYear()
    yy = yyyy % 100
    if mm < 7
      relative_year = yy
    else
      relative_year = yy + 1

    # <batch> whose score is to be shown
    batch = msg.match[1]
    year = relative_year - batch

    util.info (body) ->
      result = []
      result = parse body
      member result, year, ([user_name, slackId]) ->
        
        user_score = []

        if not msg.match[2]?
          user_name = ["```Name", user_name...]
          slackId = ["Score", slackId...]
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
        
        else
          lastChar = msg.match[2]
          if  lastChar == ' -p'
            graph_type = "pie"

          else if lastChar == ' -b'
            graph_type = "bar"

          else
            return
          
          for i in [0..slackId.length - 1]
            user_score[i] = ScoreField[slackId[i]] or 0
          
          chart = {
            type: graph_type,
            data: {
              labels: user_name,
              datasets: [{
                label: "Score",
                data: user_score
              }]
            },
            options: {
              plugins: {
                datalabels: {
                  display: true,
                  color: '#fff'
                }
              }
            }
          }
          data = encodeURIComponent(JSON.stringify(chart))
          text = "Batch#{batch} score"
          alt = "Chart showing score of batch#{batch}"
          util.graph data, text, alt, (reply) ->
            msg.send attachments: JSON.stringify(reply)

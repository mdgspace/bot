# Description:
#   Listen all the words spoken by a user.
#   Builds a dictionary of words along with the number of times it was spoken.
#   Display the words spoken by a particular user in desc order.
#   Show message stats
#
# Dependencies:
#   natural - https://www.npmjs.com/package/natural
#
# Configuration:
#   None
#
# Commands:
#   bot show me words spoken by me
#   bot stats
#
# Author:
#   csoni111

cron = require('node-cron')
natural = require 'natural'
tokenizer = new natural.WordTokenizer()

module.exports = (robot) ->
  robot.hear /^(.+)/i, (msg) ->
    if msg.match[0].toLowerCase().startsWith robot.name.toLowerCase()
      return
    words = tokenizer.tokenize msg.match[0]
    pronouns = ['i', 'he', 'she', 'it',  'we', 
                'me', 'mine', 'his', 'her', 'something', 
                'they', 'their', 'our', 'those', 
                'this', 'that', 'these', 'anything', 
                'anybody', 'anyone', 'everyone', 
                'each', 'either', 'everybody', 'none', 
                'everything', 'neither', 'nobody', 
                'nothing', 'one', 'somebody', 'someone']

    conjunctions = ['and', 'yet', 'but', 'for', 'so', 'or', 'nor']
    
    otherWords = ['a', 'at', 'in', 'for', 'is', 'am', 'are']
    
    words = words.filter (val) ->
      val.toLowerCase() not in otherWords.concat(pronouns, conjunctions)
    if words.length > 0
      name = msg.message.user.name 
      user = robot.brain.userForName name
      user.msgcount = ++user.msgcount or 1
      if typeof user is 'object'
        user.words = user.words or {}
        if Object.keys(user.words).length > 25
          removalCount=i=0
          while removalCount is 0
            i++
            for word, spokenCount of user.words
              if spokenCount <= i
                delete user.words[word]
                removalCount++
        for word in words
          user.words[word] = ++user.words[word] or 1


  robot.respond /.*show.*words.*/i, (msg) ->
    name = msg.message.user.name 
    user = robot.brain.userForName name
    if typeof user is 'object'
      sorted = []
      user.words = user.words or {}
      for word, spokenCount of user.words
        sorted.push [word, spokenCount]
      if sorted.length
        sorted.sort (a, b) ->
          b[1] - a[1]
        sorted = sorted.map (val) -> "#{val[0]}(#{val[1]})"
        msg.send sorted.join ', '
      else
        msg.send msg.random responses


  robot.respond /.*stats/i, (msg) ->
    name = msg.message.user.name 
    sender = robot.brain.userForName name
    isSenderInList = false
    response = "```Name : Message Count\n"
    sorted = listOfUsersWithCount()
    if sorted.length
      for user in sorted
        if sender.name is user[0]
          isSenderInList = true
          break
      sorted = sorted.map (val) -> "#{val[0]} : #{val[1]}"
      response += sorted.join '\n'
    response += "```"
    if not isSenderInList
      response += "\nCan't find your name?\n" + msg.random responses 
    msg.send response

  #This will run every Saturday at 9 pm
  cron.schedule '0 0 21 * * Saturday', ()->
    sorted = listOfUsersWithCount()
    name = sorted[0][0]
    currMsgRecord = sorted[0][1]
    msg = "This week's top poster is @#{name}"
    msg += " with #{currMsgRecord} messages"
    robot.send room: 'general', msg
    if currMsgRecord >= 50
      robot.emit "plusplus", {username: name}
    for own key, user of robot.brain.data.users
      if user.msgcount>0
        user.msgcount = 0


  listOfUsersWithCount = () ->
    sorted = []
    for own key, user of robot.brain.data.users
      if user.msgcount>0
        sorted.push [user.name, user.msgcount]
    if sorted.length
      sorted.sort (a, b) ->
        b[1] - a[1]
    return sorted


responses = [
  'Looks like you are more of a silent man'
  'There ain\'t anything for you!'
  'Be more active next time!'
]

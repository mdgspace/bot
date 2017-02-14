# Description:
#   Listen all the words spoken by a user.
# Builds a dictionary of words along with the number of times it was spoken.
# Display the words spoken by a particular user in desc order.
#
# Dependencies:
#   natural - https://www.npmjs.com/package/natural
#
# Configuration:
#   None
#
# Commands:
#   bot show me words spoken by me
#
# Author:
#   csoni111

natural = require 'natural'
tokenizer = new natural.WordTokenizer()

module.exports = (robot) ->
  robot.hear /^(.+)/i, (msg) ->
    if msg.match[0].toLowerCase().startsWith robot.name.toLowerCase()
      return
    words = tokenizer.tokenize msg.match[0]
    otherWords = ['is', 'an', 'the', 'and', 'or', 'a', 'me']
    words = words.filter (val) ->
      val not in otherWords
    if words.length > 0
      name = msg.message.user.name 
      user = robot.brain.userForName name
      if typeof user is 'object'
        user.words = user.words or {}
        for word in words
          user.words[word] = ++user.words[word] or 1
        if Object.keys(user.words).length > 25
          for word in Object.keys user.words
            if user.words[word] < 2
              delete user.words[word]

  robot.respond /.*show.*words.*/i, (msg) ->
    name = msg.message.user.name 
    user = robot.brain.userForName name
    if typeof user is 'object'
      sorted = []
      user.words = user.words or {}
      for word in Object.keys user.words
        sorted.push [word, user.words[word]]
        sorted.sort (a, b) ->
          b[1] - a[1]
      if sorted.length
        sorted = sorted.map (val) -> "#{val[0]}(#{val[1]})"
        msg.send sorted.join ', '
      else
        msg.send msg.random responses


responses = [
  'Looks like you are more of a silent man'
  'There ain\'t anything for you!'
  'Be more active next time!'
]
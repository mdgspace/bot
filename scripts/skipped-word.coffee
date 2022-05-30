# Description:
#   Script to maintain a list of words to be skipped
#   during the execution of some commands.
#
# Commands:
#   hubot skip word
#   hubot unskip word
#   hubot show skipped
#
# Author:
#   aman-singh7

module.exports = (robot) ->

  # returns list of skipped words
  skippedlist = () ->
    List = robot.brain.get("skippedlist") or []
    robot.brain.set("skippedlist", List)
    List

  robot.respond /skip ([\w\-_]+)/i, (msg) ->
    SkippedList = skippedlist()

    word = msg.match[1]
    # check if that word already skipped
    if word in SkippedList
      msg.send "#{word} is already skipped"
    else
      SkippedList.push(word)
      msg.send "#{word} is skipped"
  
  robot.respond /unskip ([\w\-_]+)/i, (msg) ->
    SkippedList = skippedlist()

    word = msg.match[1]
    # check if the word is skipped or not
    if word in SkippedList
      SkippedList.splice(SkippedList.indexOf(word), 1)
      msg.send "#{word} is unskipped"
    else
      msg.send "#{word} is never skipped"

  robot.respond /show skipped/i, (msg) ->
    SkippedList = skippedlist()

    # return the words if the list is not empty
    if SkippedList.length
      msg.send "#{SkippedList.join(', ')}"
    
    else
      msg.send "Nothing is skipped!!"

# Description:
#   Simple toss and roll a dice script
#
# Commands:
#   hubot toss
# hubot roll dice
# hubot roll n dices

module.exports = (robot) ->
  toss = [':head:\nHeads', ':tail:\nTails']
  dice = [':one:', ':two:', ':three:', ':four:', ':five:', ':six:']
  robot.respond /toss$/i, (msg) ->
    msg.send msg.random toss

  robot.respond /roll( \d)?( a)? dices?$/i, (msg) ->
    i=1
    numbers = []
    if msg.match[1]
      i=parseInt msg.match[1].trim()
    while i>0
      numbers.push dice[Math.floor Math.random()*6]
      i--
    msg.send numbers.join ' '

# Description:
#   Simple toss and roll a dice script
#
# Commands:
#   hubot toss
# hubot roll dice
# hubot roll n dices

module.exports = (robot) ->
  toss = ['Head', 'Tail']
  robot.respond /toss$/i, (msg) ->
    msg.send msg.random toss

  robot.respond /roll( \d{3})? dices?$/i, (msg) ->
    i=1
    numbers = []
    if msg.match[1]
      i=parseInt msg.match[1].trim()
    while i>0
      numbers.push Math.ceil Math.random()*6
      i--
    msg.send numbers.join ', ' 
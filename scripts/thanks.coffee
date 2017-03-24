# Desciption:
#	Thanks/Thank you/Thanx/Thnks/Thnx
# Commands:
#	Thanks/Thank you/Thanx/Thnks/Thnx

module.exports = (robot) ->
  robot.hear /(thanks|thank you|thanx|thnks|Thanx)/i, (msg) ->
    reply = [
      "Don't say "+msg.match[0]+". Give ++",
      "You are not welcome until you give ++",
      "The pleasure is all mine",
      "The pleasure is only yours",
      "Dost ko thanks bolta hai",
      "You are welcome"
    ]
    msg.send msg.random reply

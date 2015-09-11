# Desciption:
#	Thanks/Thank you/Thanx/Thnks/Thnx
# Commands:
#	Thanks/Thank you/Thanx/Thnks/Thnx

module.exports = (robot) ->
  robot.hear /(thanks|thank you|thanx|thnks|thnx)/i, (msg) ->
     reply="Don't say "+msg.match[0]+". Give ++ "
     msg.send reply

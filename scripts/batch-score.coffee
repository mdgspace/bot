# Description:
#   Script for batch wise score.
#
# Commands:
#   hubot score bxx
# 
# Author:
#   aseem09

cron = require('node-cron')
module.exports = (robot) ->

  listOfUsersWithCount = (year) ->
  
    sorted = []
    for own key, user of robot.brain.data.users

      temp2=user[4]
      user_year=temp2.split('')
      temp3 = parseInt( user_year[0], 10 );

      if `temp3 == year` > 0
        sorted.push [user.name, user.msgcount]

    if sorted.length
      sorted.sort (a, b) ->
        b[1] - a[1]
    return sorted
  
  # response for score status of any <batch>
  robot.respond /score b([\w\-_]+)/i, (msg) ->

    response = "```Name : Message Count\n"

    #passing year of current first
    relative_year=23

    #changing the relative at the end of the year
    cron.schedule '0 0 9 7 *', ()->
      `relative_year = relative_year + 1`

    # <batch> whose score is to be shown
    batch = msg.match[1]
    year= relative_year - batch
    sorted= listOfUsersWithCount(year)
    sorted = sorted.map (val) -> "#{val[0]} : #{val[1]}"
    response += sorted.join '\n'
    response += "```"

    msg.send response

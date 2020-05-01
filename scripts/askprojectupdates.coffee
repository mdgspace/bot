# Description:
#   Asks every satudrday morning 10 AM for project updates on #announcements

cron = require('node-cron')

module.exports = (robot) ->

  #Runs every Saturday at 10 AM
  cron.schedule '0 0 10 * * Saturday', ()->
    msg = responses[Math.floor(Math.random() * (response.length-1))]
    robot.send room: 'announcements', msg
    
responses = [
  'Hey folks! Its update time. Mentors please post the project milestones and updates from this week.\nWhat do you plan to do next week?'
]

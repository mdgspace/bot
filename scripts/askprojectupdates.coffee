# Description:
#   Asks every satudrday morning 11.30 AM for project updates on #announcements

cron = require('node-cron')

module.exports = (robot) ->

  #Runs every Saturday at 11.30 AM
  cron.schedule '0 30 11 * * Saturday', ()->
    msg = responses[Math.floor(Math.random() * (responses.length))]
    robot.send room: 'announcements', msg
    
responses = [
  'Hey folks! Its update time. Mentors please post the project milestones and updates from this week.\nWhat do you plan to do next week?'
  'Kaam kar rahe ho?\nPost project milestones and updates from this week with milestones of upcoming week.'
]

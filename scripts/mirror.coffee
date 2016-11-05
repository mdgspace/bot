###############################################################################################
# Description:
#   cron jobs for managing the MDG Mirror Spreadsheet
#   
#   1) Adds new week column in the sheet every Sunday 9 pm.
#   2) Reminds those who have not filled the sheet every tuesday and thursday at 6 am. 
#
###############################################################################################

https = require('follow-redirects').https
cron = require('node-cron')

url = "https://script.google.com/macros/s/AKfycbyORsjXLiVK4wC4VwaAUMFZ28pE7IYOf5Sx_Tmbk1S9YvXhbsU/exec"

module.exports = (robot) ->

#This will run every Sunday at 9 pm 
  cron.schedule '0 0 21 * * Sunday', ()->
    https.get url+"?type=3", (res) -> 
      res.on 'data', (body) ->
        robot.send room: 'general', "Added new week to Mdg Mirror"
      # res.on 'end', () ->

#This will run on every tuesday and thursday at 6 am
  cron.schedule '0 0 6 * * Tuesday,Thursday', ()->
    https.get url+"?type=2", (res) -> 
      res.on 'data', (body) ->
        namesArray = JSON.parse body
        namesArray = namesArray.map (el)->
          return '@'+el
        names = namesArray.join " "
        robot.send room: 'general', names+"\nPlease fill up the activities sheet."
 
######################################################################################
# Description:
#   cron jobs for managing the MDG Mirror Spreadsheet
#   
#   1) Adds new week column in the sheet every Sunday 9 pm.
#   2) Reminds those who have not filled the sheet every Tuesday and Friday at 6 am. 
#
######################################################################################

https = require('follow-redirects').https
cron = require('node-cron')
output = ''

module.exports = (robot) ->

  if (url = process.env.MIRROR_SCRIPT_URL)
    
    #This will run every Sunday at 9 pm 
    cron.schedule '0 0 21 * * Sunday', ()->
      https.get url+"?type=3", (res) -> 
        res.on 'data', (body) ->
          output += body
        res.on 'end', () ->
          robot.send room: 'general', "Added new week to Mdg Mirror. (#{output})"
          output = ''

    #This will run every Tuesday and Friday at 6 am
    cron.schedule '0 0 6 * * Tuesday,Friday', ()->
      https.get url+"?type=2", (res) -> 
        res.on 'data', (body) ->
          output += body
        res.on 'end', () ->
          namesArray = JSON.parse output
          unless namesArray.length
            return
          namesArray = namesArray.map (el) -> return '@'+el
          names = namesArray.join " "
          robot.send room: 'general', names+"\nPlease fill up the activities sheet."
          output = ''

  # else
    # console.log "MIRROR_SCRIPT_URL not found in environment variables"
 
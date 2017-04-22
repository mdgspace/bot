# Description:
# Returns the number of likes on MDG page on FB
# 
# Dependencies:
#   None
#
# Configuration:
#   FB_APP_ACCESS_TOKEN
#
# Commands:
#   hubot fb likes
#
# Author:
#   abhshkdz, csoni111

module.exports = (robot) ->

  robot.respond /fb(\s*)likes/i, (msg) ->
    https = require 'https'
    https.get {host: 'graph.facebook.com', path: "/mdgiitr?access_token=#{process.env.FB_APP_ACCESS_TOKEN}&fields=fan_count"}, (res) ->
      data = ''
      res.on 'data', (chunk) ->
        data += chunk.toString()
      res.on 'end', () ->
      	console.log data
      	data = JSON.parse(data)
      	msg.send "#{data['fan_count']}"
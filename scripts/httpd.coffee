# Description:
#   A simple interaction with the built in HTTP Daemon
#
# Dependencies:
#   None
#
# Configuration:
#   None
#
# Commands:
#   None
#
# URLS:
#   /hubot/version
#   /hubot/ping
#   /hubot/time
#   /hubot/info
#   /hubot/ip


spawn = require('child_process').spawn
util = require('./util')

module.exports = (robot) ->
  
  robot.router.get "/hubot/version", (req, res) ->
    res.end robot.version

  robot.router.post "/hubot/ping", (req, res) ->
    res.end "PONG"

  robot.router.get "/hubot/time", (req, res) ->
    res.end "Server time is: #{new Date()}"

  robot.router.get "/hubot/info", (req, res) ->
    child = spawn('/bin/sh', ['-c', "echo I\\'m $LOGNAME@$(hostname):$(pwd) \\($(git rev-parse HEAD)\\)"])

    child.stdout.on 'data', (data) ->
      res.end "#{data.toString().trim()} running node #{process.version} [pid: #{process.pid}]"
      child.stdin.end()

  robot.router.get "/hubot/ip", (req, res) ->
    robot.http('http://ifconfig.me/ip').get() (err, r, body) ->
      res.end body

  robot.router.post "/hubot/slack", (request, response) ->
    check = process.env.HUBOT_ENV_AUTH_TOKEN

    if request.headers.authorization == check
      data = request.body
      responseobj = {}
      if data.queryResult.parameters.name == ""
        console.log(data.queryResult.parameters.any)
        robot.send room: 'general', "Announcement : '#{data.queryResult.parameters.any}'"
      else
        query = data.queryResult.parameters.name.toLowerCase()
        util.info (body) ->
          result = parse body, query
          console.log(result.length)
          if result.length==0
            responseobj =     {
              "fulfillmentText": "This is a text response",
              "fulfillmentMessages": [
              ],
              "source": " ",
              "payload": {
                "google": {
                  "expectUserResponse": true,
                  "richResponse": {
                    "items": [
                      {
                        "simpleResponse": {
                          "textToSpeech": "No user found"
                        }
                      },
                    ]
                  }
                },
              }
            }
          else
            if result.length==1
              responseobj =     {
                "fulfillmentText": "This is a text response",
                "fulfillmentMessages": [
                ],
                "source": " ",
                "payload": {
                  "google": {
                    "expectUserResponse": true,
                    "richResponse": {
                      "items": [
                        {
                          "simpleResponse": {
                            "textToSpeech": "Here it is"
                          }
                        },
                        {
                                  "basicCard":{
                                      "formattedText": "Github : "+result[0][8]+"\n  \nMobile : "+result[0][1]+"\n  \nEmail : "+result[0][2]+"\n  \n"+result[0][4]+"    "+result[0][5]+"    ("+result[0][6]+")",
                                      "title":result[0][0]
                                  }
                              }
                      ]
                    }
                  },
                }
              }
            else
              basicCardArray = []
              for user in result
                basicCardArray1 = {
                  "description":"Github : "+user[8]+"\nMobile : "+user[1]+"\nEmail : "+user[2]+"\n"+user[4]+"       "+user[5]+"   ("+user[6]+")" ,
                  "title":user[0],
                  "openUrlAction": {
                      "url": "https://github.com/"+user[8]
                    },

                }
                basicCardArray.push basicCardArray1
              responseobj =     {
                "fulfillmentText": "This is a text response",
                "fulfillmentMessages": [
                ],
                "source": " ",
                "payload": {
                  "google": {
                    "expectUserResponse": true,
                    "richResponse": {
                      "items": [
                        {
                          "simpleResponse": {
                            "textToSpeech": "Here it is"
                          }
                        },
                        {
                                  "carouselBrowse": {
                                    "items" : basicCardArray
                                  }
                              },
                      ]
                    }
                  },
                }
              }
          console.log(responseobj)
          response.writeHead 200,
              'Content-Type':   'application/json'
          response.end JSON.stringify(responseobj)
    else
      console.log("unauthorized request")
      response.writeHead 404


parse = (json, query) ->
  result = []
  for line in json.toString().split '\n'
    y = line.toLowerCase().indexOf query
    if y != -1
      result.push line.split(',').map Function.prototype.call, String.prototype.trim
  if result != ""
    result
  else
    false
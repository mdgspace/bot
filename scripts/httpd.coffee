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
      if data.queryResult.parameters.person == ""
        console.log(data.queryResult.parameters.message)
      else
        query = data.queryResult.parameters.person.name.toLowerCase()
        robot.http(process.env.INFO_SPREADSHEET_URL)
        .query({
          output: "csv"
        })
        .get() (err, res, body) ->
          result = parse body, query
          if result.length == 0
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
            for user in result
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
                                      "formattedText":"Github : "+user[8]+"\n  \nMobile : "+user[1]+"\n  \nEmail : "+user[2]+"\n  \nYear : "+user[4]+"\n  \nBranch : "+user[5]+"\n  \nEnrollment no : "+user[6]+"\n  \nDOB : "+user[3],
                                      "title":user[0]
                                  }
                              }
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

randomColor = () ->
  return '#'+(0x1000000+(Math.random())*0xffffff).toString(16).substr(1,6);




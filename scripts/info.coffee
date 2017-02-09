# Description:
#   gets sdslabs member's info from google doc
#   Type a partial name to get all matches
#
# Configuration:
#   INFO_SPREADSHEET_URL
#
# Commands:
#   hubot info <partial name> - Get information about a person

module.exports = (robot) ->
  robot.respond /(info|sdsinfo) (.+)$/i, (msg)  ->
    query = msg.match[2].toLowerCase()
    robot.http("https://docs.google.com/spreadsheets/d/1lD7wCg-vwr8TrlYg9v9FJwF7N99eS-fXTTD3Xa7J4oM/pub")
      .query({
        output: "csv"
      })
      .get() (err, res, body) ->
        result = parse body, query
        if not result 
          msg.send "I could not find a user matching `"+query.toString()+"`"
        else
          msg.send result.length+" user(s) found matching `"+query.toString()+"`"
          for user in result
            output = 
              "fallback": user.join ' \t '
              "color": randomColor()
              "pretext": user[0]
              "title": user[0]
              "title_link": "https://facebook.com/"+user[9]
              "text": "*Github id:* "+user[8]+
              "\n*Fb:* <https://facebook.com/"+user[9]+"|"+user[9]+">"+
              "\n*Room no:* "+user[7]+
              "\n*Desg:* "+user[4]+" "+user[5]+" ("+user[6]+")"+
              "\n*DOB:* "+user[3]
              "fields": [
                  "title": "Mobile"
                  "value": "<tel:"+user[1]+"|"+user[1]+">"
                  "short": true
                ,
                  "title": "Email"
                  "value": "<mailto:"+user[2]+"|"+user[2]+">"
                  "short": true
                ,
              ]
              "footer": user[4]+" "+user[5]+" ("+user[6]+")"
              "ts": new Date(user[3]).getTime()

            sendMessage output, msg


  sendMessage = (content, msg) ->
    payload = 
      message: msg.message
      content: content
    robot.emit 'slack-attachment', payload

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



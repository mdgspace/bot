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
  robot.respond /(info|sdsinfo) (.+)$/i, (msg) ->
    query = msg.match[2]
    robot.http("https://docs.google.com/spreadsheets/d/1lD7wCg-vwr8TrlYg9v9FJwF7N99eS-fXTTD3Xa7J4oM/pub")
      .query({
        output: "csv"
        alt: 'json'
        q: query
      })
      .get() (err, res, body) ->
        msg.send parse body, query

parse = (json, query) ->
  result = ""
  for line in json.toString().split '\n'
    y = line.indexOf query
    if y != -1
      result += line.replace(/,/g, '<br>') + '\n\n'
  if result != ""
    result.trim()
  else
    "No user found"

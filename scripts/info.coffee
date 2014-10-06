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
    robot.http("https://docs.google.com/spreadsheet/pub")
      .query({
        key: "0AoxM45kt4KbidG52TjdndTlORDl5czNVdlJEUVVTaGc"
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
      result += line.replace(/,/g, ' ') + '\n\n'
  if result != ""
    result.trim()
  else
    "No user found"

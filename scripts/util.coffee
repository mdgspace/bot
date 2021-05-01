https = require('follow-redirects').https

# Get the user details
info = (callback) ->
  output = ''
  https.get process.env.INFO_SPREADSHEET_URL + "?output=csv", (res) ->
    res.on 'data', (body) ->
      output += body
    res.on 'end', () ->
      callback output
    res.on 'error', (err) ->
      callback err

parse = (json, query, returnSingle) ->
  result = []
  for line in json.toString().split '\n'
    y = line.toLowerCase().indexOf query
    if y != -1
      if returnSingle
        return line.split(',').map Function.prototype.call, String.prototype.trim
      else
        result.push line.split(',').map Function.prototype.call, String.prototype.trim
  if result != ""
    return result
  else
    return false
  
  module.exports.parse = parse
  module.exports.info = info
  

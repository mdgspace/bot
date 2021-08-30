https = require('follow-redirects').http

# Get the user details
exports.info = (callback) ->
  output = ''
  https.get process.env.INFO_SPREADSHEET_URL + "?output=csv", (res) ->
    res.on 'data', (body) ->
      output += body
    res.on 'end', () ->
      callback output
    res.on 'error', (err) ->
      callback err

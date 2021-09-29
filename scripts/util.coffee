https = require('follow-redirects').https

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


# Graph Attachment
exports.graph = (enc_url, text, alt_text, callback) ->
  attachments = [
    {
      color: "#f2c744",
      blocks: [
        {
          type: "image",
          title: {
            type: "plain_text",
            text: text
          },
          image_url: "https://quickchart.io/chart?c=#{enc_url}",
          alt_text: alt_text
        }
      ]
    }
  ]
  callback attachments
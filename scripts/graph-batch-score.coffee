# Description:
#   Script for batch wise score graph.
#
# Configuration:
#   INFO_SPREADSHEET_URL
#
# Commands:
#   hubot graph score fxx -b    for Bar Graph
#   hubot graph score fxx -p    for Pie Graph
#
# Author:
#   aman-singh7

util = require('./util')
batchScore = require('./batch-score')

module.exports = (robot) ->

  robot.respond /graph score f(\d\d) (\-)+[bpBP]/i , (msg) ->
    lastChar = msg.match[0][-1..].toLowerCase()
        
    batch = msg.match[1]
    util.year batch, (year) ->
      util.info (body) ->
        util.parse body, (result) ->
          util.member result, year, ([user_name, slackId]) ->
            util.scorefield robot, (ScoreField) ->
              user_score = []
              for i in [0..slackId.length - 1]
                user_score[i] = ScoreField[slackId[i]] or 0
            
              if  lastChar == 'p'
                graph_type = "pie"
              else
                graph_type = "bar"

              chart = {
                type: graph_type,
                data: {
                  labels: user_name,
                  datasets: [{
                    labels: "Score",
                    data: user_score
                  }]
                },
                options: {
                  plugins: {
                    datalabels: {
                      display: true,
                      color: '#fff'
                    }
                  }
                }
              }
              data = encodeURIComponent(JSON.stringify(chart))
              reply = {
                attachments: [
                  {
                    color: "#f2c744",
                    blocks: [
                      {
                        type: "image",
                        title: {
                          type: "plain-text",
                          text: "Batch#{batch} score"
                        },
                        image_url: "https://quickchart.io/chart?c=#{data}"
                        alt_text: "Chart showing score of batch#{batch}"
                      }
                    ]
                  }
                ]
              }
              msg.send JSON.stringify(reply)

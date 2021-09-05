# Description:
#   Script for batch wise score graph.
#
# Configuration:
#   INFO_SPREADSHEET_URL
#
# Commands:
#   hubot graph score fxx       Default(Bar graph)
#   hubot graph score fxx -b    for Bar Graph
#   hubot graph score fxx -p    for Pie Graph
#
# Author:
#   aman-singh7

util = require('./util')

module.exports = (robot) ->

  robot.respond /graph score f(\d\d)( \-\w)?/i , (msg) ->
  
    batch = msg.match[1]
    lastChar = msg.match[2] || ' -b'
    if  lastChar == ' -p'
      graph_type = "pie"
    else if lastChar == ' -b'
      graph_type = "bar"
    else
      return

    util.year batch, (year) ->
      util.info (body) ->
        util.parse body, (result) ->
          util.member result, year, ([user_name, slackId]) ->
            util.scorefield robot, (ScoreField) ->
              user_score = []
              for i in [0..slackId.length - 1]
                user_score[i] = ScoreField[slackId[i]] or 0

              chart = {
                type: graph_type,
                data: {
                  labels: user_name,
                  datasets: [{
                    label: "Score",
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
              text = "Batch#{batch} score"
              alt = "Chart showing score of batch#{batch}"
              util.graph data, text, alt, (reply) ->
                msg.send attachments: JSON.stringify(reply)

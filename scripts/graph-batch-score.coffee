# Description:
#   Script for batch wise score graph.
#
# Configuration:
#   INFO_SPREADSHEET_URL
#
# Commands:
#   hubot graph score fxx
#
# Author:
#   aman-singh7

util = require('./util')

module.exports = (robot) ->

    scorefield = () ->
        Field = robot.brain.get("scorefield") or {}
        robot.brain.set("scorefield",Field)
        Field

    parse = (json) ->
        result = []
        for line in json.toString().split '\n'
            result.push line.split(',').map Function.prototype.call,
            String.prototype.trim
        if result != ""
            result
        else
            false

    robot.respond /graph score f(\d\d)/i , (msg) ->

        ScoreField = scorefield()

        today = new Date
        mm = today.getMonth() + 1
        yyyy = today.getFullYear()
        yy = `yyyy % 100`
        if `mm < 7`
            `relative_year = yy`
        else
            `relative_year = yy + 1`
        
        batch = msg.match[1]
        year =  relative_year - batch
        
        util.info (body) ->
            result = []
            result = parse body
            user_name = []
            slackId = []
            for user in result
                if (user.length >= 13)
                    user_year = user[4].split('')
                    year_info = parseInt(user_year[0], 10 );
                    if `year_info == year`
                        if user[10]
                            slackId.push [user[10]]
                            user_name.push user[0]
        
            user_score = []
            
            for i in [0..slackId.length - 1]
                user_score[i] = ScoreField[slackId[i]] or 0
            
            chart = {
                type: "pie",
                data: {
                    labels: user_name,
                    datasets: [{
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
            msg.send(
                attachments: [
                    "color": "#f2c744"
                    "blocks": [
                        "type": "image"
                        "title": {
                            "type": "plain_text",
                            "text": "Batch#{batch} score"
                        },
                        "image_url": "https://quickchart.io/chart?c=#{data}"
                        "alt_text": "Chart showing score of batch#{batch}"
                    ]
                ]
            )
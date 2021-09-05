# Description:
#   Script for message count graph.
#
# Commands:
#   hubot graph stats
#
# Author:
#   aman-singh7


util = require('./util')

module.exports = (robot) ->

    robot.respond /graph stats/i, (msg) ->
        name = []
        msgcount = []
        for own key, user of robot.brain.data.users
            if user.msgcount > 0
                name.push user.name
                msgcount.push user.msgcount

        chart = {
            type: "bar",
            data: {
                labels: name,
                datasets: [{
                    label: "Message Count",
                    data: msgcount
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
        text = "Message Count"
        alt = "Chart showing message count"
        util.graph data, text, alt, (reply) ->
            msg.send JSON.stringify(reply)

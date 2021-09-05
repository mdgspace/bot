# Description:
#   Script for detailed score graph.
#
# Commands:
#   hubot graph detailed score name
#
# Author:
#   aman-singh7

util = require('./util')

module.exports = (robot) ->
    class Person
        constructor: (@name, @plus = 0, @minus = 0) ->
            
        plusFn: (val) ->
            @plus += val
        minusFn: (val) ->
            @minus -= val

    isExist = (list, name) ->
        idx = 0
        for person in list
            if person.name == name
                index = idx
            idx++
        
        return index || -1
    
    
    robot.respond /graph detailed score ([\w\-_]+)/i, (msg) ->
        name = msg.match[1]
        name = name.toLowerCase()
        detailedfield = robot.brain.get('detailedfield')
        list = []
        if detailedfield[name]?
            if detailedfield[name]['plus']?
                for key, value of detailedfield[name]['plus']
                    list.push new Person key, value, 0

            if detailedfield[name]['minus']?
                for key, value of detailedfield[name]['minus']
                    idx = isExist list, key
                    if idx != -1 then list[idx].minusFn(value)
                    else list.push new Person key, 0, -value
        else
            msg.send 'No such user found!'
            return
        
        nameList = []
        plus = []
        minus = []

        list.map (p) ->
            nameList.push p.name
            plus.push p.plus
            minus.push p.minus
        
        graph = {
            type: "bar"
            data: {
                labels: nameList,
                datasets: [
                    {
                        label: "++",
                        backgroundColor: "rgba(54, 162, 235, 0.5)",
                        borderColor: "rgba(54, 162, 235)",
                        borderWidth: 1,
                        data: plus,
                    },
                    {
                        label: "--"
                        backgroundColor: "rgba(255, 99, 132, 0.5)",
                        borderColor: "rgba(255, 99, 132)"
                        borderWidth: 1
                        data: minus
                    },
                ],
                options: {
                    title: {
                        display: true,
                        text: "Detailed Score of #{name}",
                    },
                    plugins: {
                        datalabels: {
                            anchor: "center",
                            align: "center",
                            color: "#666",
                            font: {
                                weight: 'normal',
                            },
                        },
                    },
                },
            }
        }
        chart = encodeURIComponent(JSON.stringify(graph))
        util.graph chart, "Detailed Score of #{name}", "Graph Showing Detailed Score", (reply) ->
            msg.send JSON.stringify(reply)

# Description:
#   Fetches and sends a random quote from the internet.
# 
# Dependencies:
#   node-soupselect
#   node-htmlparser
#
# Configuration:
#   NONE
#
# Commands:
#   random quote
#
# Author:
#   csoni111

select = require('soupselect').select
htmlparser = require 'htmlparser'

module.exports = (robot) ->
    fetchRandomQuote = (callback) ->
        robot.http("http://inspirationalshit.com/endlessquotesrotator.php")
            .get() (err, res, body) ->
                if err
                    callback false #, "error: #{err}"
                    return
                if res.statusCode isnt 200
                    callback false #, "statusCode: #{res.statusCode}"
                    return

                handler = new htmlparser.DefaultHandler (err, dom) ->
                    if err
                        callback false
                    else
                        quote = select dom, 'blockquote p'
                        author = select dom, 'blockquote footer cite'
                        callback true, quote[0].children[0].raw, author[0].children[0].raw
                
                parser = new htmlparser.Parser handler
                parser.parseComplete body

    robot.respond /.*random.*quote.*/i , (msg) ->
        fetchRandomQuote (success, quote, author) ->
            if success
                msg.send "_#{quote}_ - #{author}"
            else
                msg.send '_error_'

    robot.on 'send:quote', (randomMsg) ->
        fetchRandomQuote (success, quote, author) ->
            if success
                randomMsg = "_#{quote}_ - #{author}"
            robot.send room: 'general', randomMsg
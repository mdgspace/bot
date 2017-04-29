# Description:
#   Fetch random posts from any facebook page
# 
# Dependencies:
#   https
#
# Configuration:
#   FB_APP_ACCESS_TOKEN
#
# Commands:
#   hubot fb feed <page-id>
#
# Author:
#   csoni111

https = require 'https'

access_token = "access_token=#{process.env.FB_APP_ACCESS_TOKEN}"
options = {host: 'graph.facebook.com'}

module.exports = (robot) ->

    robot.on 'send:fb-feed', (page_name) ->
        getRandomPost page_name, (data) ->
            sendMessage data, 'general'

    robot.respond /fb feed (.+)$/i, (msg)  ->
        if access_token.includes 'undefined'
            msg.send "Looks like `FB_APP_ACCESS_TOKEN` is missing :thinking_face:"
        else
            page_name = msg.match[1].trim()
            getRandomPost page_name, (data) ->
                sendMessage data, msg.message.room

    sendMessage = (content, channel) ->
        payload = 
            message: {'room': channel}
            content: content
        robot.emit 'slack-attachment', payload



#returns a random post from a given fb page    
getRandomPost = (page_name, callback) ->
    options.path = "/#{page_name}/feed?#{access_token}"
    https.get options, (res) ->
        data = ''
        res.on 'data', (chunk) ->
            data += chunk.toString()
        res.on 'end', () ->
            data = JSON.parse(data).data
            post = data[Math.floor data.length * Math.random()]
            fetchPageDetails page_name, (page) ->
                output = 
                    "fallback": post.message
                    "text": ""
                    "pretext": post.message
                    "color": "#fc554d"
                    "author_name": page.name
                    "author_link": page.link
                    "author_icon": page.picture.data.url
                    "title": post.message
                    "title_link": "https://facebook.com/#{post.id}"
                    "ts": new Date(post.created_time).getTime() / 1000
                fetchPostAttachments post.id, (likes, image_url) ->
                    output.footer = "#{likes} Likes"
                    if image_url is not null
                        output.image_url = image_url
                    callback(output)


#returns page details
fetchPageDetails = (page_name, callback) ->
    options.path = "/#{page_name}?#{access_token}&fields=name,link,about,picture{url}"
    https.get options, (res) ->
        data = ''
        res.on 'data', (chunk) ->
            data += chunk.toString()
        res.on 'end', () ->
            data = JSON.parse(data)
            callback data


fetchPostAttachments = (post_id, callback) ->
    options.path = "/#{post_id}/?#{access_token}&fields=attachments{media},likes.limit(0).summary(true)"
    https.get options, (res) ->
        post_data = ''
        res.on 'data', (chunk) ->
            post_data += chunk.toString()
        res.on 'end', () ->
            post_data = JSON.parse(post_data)
            likes = post_data.likes.summary.total_count
            image_url = null
            if 'attachments' in post_data
                image_url = post_data.attachments.data[0].media.image.src
            callback likes, image_url
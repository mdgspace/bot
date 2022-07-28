# Description:
#   partychat like chat-score/leaderboard script built at 'SDSLabs'
#   we developed this to use in our 'Slack' team instance
#
# Commands:
#   listen for * has/have keys in chat text and displays users with the keys/updates the user having keys
#   bot who has keys : returns current user having lab keys
#   bot i have keys : set's the key-holder to the user who posted
#   bot i dont have keys : unsets the user who posted from key-holders
#	bot xyz has keys : sets xyz as the holder of keys
#
# Examples:
#   :bot who has keys
#   :bot i have keys
#   :bot i dont have keys
#	:bot who has keys
#	:bot ravi has keys
#
# Author:
#   Punit Dhoot (@pdhoot)
#   Developer at SDSLabs (@sdslabs)

module.exports = (robot)->

	key = ()->
		Key = robot.brain.get("key") or []
		robot.brain.set("key" ,Key)
		Key	
	
	
	robot.respond /i have (a key|the key|key|keys) of (.+)/i, (msg)->
		name = msg.message.user.name 
		ownerName = msg.match[2]
		user = robot.brain.userForName name
		try
			kh = key()
			if typeof user is 'object'
				msg.send "Okay #{name} has keys"
				kh.push holder:name,owner:ownerName
			robot.brain.set("key",kh)
		catch e	
			console.log e



	robot.respond /i (don\'t|dont|do not) (has|have) (the key|key|keys|a key)/i , (msg)->
		name = msg.message.user.name
		kh = key()
		check =0
		for x in kh
			if x.holder is name
				index=kh.indexOf(x)
				owner = x.owner
				kh.splice(index,1)
				check=1
				msg.send "Okay #{name} doesn't have keys.Then, Who got the keys of #{owner}?"
		if typeof user is 'object'
			if check is 0
				msg.send "Yes , i know buddy"	
		robot.brain.set("key",kh)	


	robot.respond /(.+) (has|have) (the key|key|keys|a key) of (.+)/i , (msg)->
		othername = msg.match[1]
		ownerName = msg.match[4]
		name = msg.message.user.name
		k = key()
		if ownerName is ""
			msg.send "okay, but whose key"
		else
			unless othername in ["who", "who all","Who", "Who all" , "i" , "I" , "i don't" , "i dont" , "i do not" , "I don't" , "I dont" , "I do not"]
				if othername is 'you'
					msg.send "How am I supposed to take those keys? #{name} is a liar!"
				else if othername is robot.name
					msg.send "How am I supposed to take those keys? #{name} is a liar!"
				else
					users = robot.brain.usersForFuzzyName othername
					userso = robot.brain.usersForFuzzyName ownerName
					if users.length is 1
						if userso.length is 1
							k.push holder:users[0].name,owner:userso[0].name
							robot.brain.set("key", k)
							msg.send "Okay, so now the key of #{userso[0].name} are with #{users[0].name}"
						else if users.length > 1
							msg.send getAmbiguousUserText users
						else
							msg.send "#{ownerName}? Never heard of 'em"
					else if users.length > 1
						msg.send getAmbiguousUserText users
					else
						msg.send "#{othername}? Never heard of 'em"

	robot.respond /(i|I) (have given|gave|had given) (the key|key|keys|a key|the keys) to (.+)/i , (msg)->
		othername = msg.match[4]
		name = msg.message.user.name
		k = key()
		if othername is 'you'
			msg.send "That's utter lies! How can you blame a bot to have the keys?"
		else if othername is robot.name
			msg.send "That's utter lies! How can you blame a bot to have the keys?"
		else
			users = robot.brain.usersForFuzzyName othername
			if users is null
				msg.send "I don't know anyone by the name #{othername}"
			else
				check =0;
				for x in k
					if x.holder is name
						x.holder = users[0].name
						msg.send "Okay, so now the keys of #{x.owner} are with #{users[0].name}"
						check=1
				if check is 0
					msg.send "Liar, you don't have the keys"
		robot.brain.set("key",k)		
				
	robot.respond /(who|who all) (has|have) (the key|key|keys|a key)/i , (msg)->
		try
			kh = key()
			if kh is []
				msg.send "Ah! Nobody informed me about the keys. Don't hold me responsible for this :expressionless:"
			else
				list = []
				msgText=[]
				for x in kh
					list.push "#{x.owner}'s key are with #{x.holder}"
				msgText += list.join '\n'
				msgText+=""
				if msgText is ""
					msg.send "Ah! Nobody informed me about the keys. Don't hold me responsible for this :expressionless:"
				else
					msg.send msgText
				robot.brain.set("key" ,kh)
		catch e
			console.log e

	robot.respond /who (has|have) (.+) ('s key|'s keys)/i , (msg)->
		ownerName = msg.match[2];
		users = robot.brain.usersForFuzzyName ownerName
		s = ""
		try
			kh = key()
			if users.length is 1
				for x in kh
					if x.owner is users[0].name
						s = "#{x.owner} keys are with #{x.holder}"
				msg.send s
			else if users.length > 1
				msg.send getAmbiguousUserText users
			else
				msg.send "#{ownerName}? Never heard of 'em"
			robot.brain.set("key" ,kh)
		catch e
			console.log e

				


getAmbiguousUserText = (users) ->
    "Be more specific, I know #{users.length} people named like that: #{(user.name for user in users).join(", ")}"


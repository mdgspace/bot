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
#   :bot who has <color> keys
#   :bot i have <color> keys
#   :bot i dont have <color> keys
#	:bot who has <color> keys
#	:bot ravi has <color> keys
#
# Author:
#   Punit Dhoot (@pdhoot)
#   Developer at SDSLabs (@sdslabs
#  Edit:
#   prakhar gupta


module.exports = (robot)->

	keyRed = ()->
		Key1 = robot.brain.get("keyRed") or ""
		robot.brain.set("keyRed",Key1)
		Key1	
	keyBlue = ()->
		Key2 = robot.brain.get("keyBlue") or ""
		robot.brain.set("keyBlue",Key2)
		Key2	
	keyYellow = ()->
		Key3 = robot.brain.get("keyYellow") or ""
		robot.brain.set("keyYellow",Key3)
		Key3	
	keyGreen = ()->
		Key4 = robot.brain.get("keyGreen") or ""
		robot.brain.set("keyGreen",Key4)
		Key4	
	keyOrange = ()->
		Key5 = robot.brain.get("keyOrange") or ""
		robot.brain.set("keyOrange",Key5)
		Key5	

    #1this section belongs to "i have keys"
	robot.respond /i (have the|have) (.+) (key|keys)/i, (msg)->
		keyname = msg.match[2]
		name = msg.message.user.name 
		user = robot.brain.userForName name
		unless keyname not in  ["red", "blue", "yellow", "green", "orange"]
			if keyname is 'red'
				key_holder = keyRed()
				key_holder = user.name
				robot.brain.set("keyRed",key_holder)
			else if keyname is 'blue'
				key_holder = keyBlue()
				key_holder = user.name
				robot.brain.set("keyBlue",key_holder)
			else if keyname is 'Yellow'
				key_holder = keyYellow()
				key_holder = user.name
				robot.brain.set("keyYellow",key_holder)
			else if keyname is 'Green'
				key_holder = keyGreen()
				key_holder = user.name
				robot.brain.set("keyGreen",key_holder)
			else if keyname is 'orange'
				key_holder = keyOrange()
				key_holder = user.name
				robot.brain.set("keyOrange",key_holder)
			if typeof user is 'object'
				msg.send "Okay #{name} has #{keyname} keys"	

	#2this section belongs to "i dont have key"
	robot.respond /i (do not|don\'t|dont) (has the|have the|has|have) (.+) (key|keys)/i , (msg)->
		keyname = msg.match[3]
		name = msg.message.user.name
		user = robot.brain.userForName name
		unless keyname not in  ["red", "blue", "yellow", "green", "orange"]
			if keyname is 'red' 
				key_holder = keyRed()
				if key_holder is name
					key_holder = ""	
				robot.brain.set("keyRed",key_holder)	
			else if keyname is 'blue'
				key_holder = keyBlue()
				if key_holder is name
					key_holder = ""
				robot.brain.set("keyBlue",key_holder)	
			else if keyname is 'yellow'
				key_holder = keyYellow()
				if key_holder is name
					key_holder = ""	
				robot.brain.set("keyYellow",key_holder)
			else if keyname is 'green'
				key_holder = keyGreen()
				if key_holder is name
					key_holder = ""	
				robot.brain.set("keyGreen",key_holder)
			else if keyname is 'orange'
				key_holder = keyOrange()
				if key_holder is name
					key_holder = ""	
				robot.brain.set("keyOrange",key_holder)
			if typeof user is 'object'
				if key_holder is ""
					msg.send "Okay #{name} doesn't have #{keyname} keys. Who got the #{keyname} keys then?"
				else
					msg.send "Yes , I know buddy, its because #{key_holder} has got the #{keyname} keys"

    #3this section belongs to "$name has keys"
	robot.respond /(.+) (has the|have the|has|have) (.+) (key|keys)/i , (msg)->
		othername = msg.match[1]
		keyname = msg.match[3]
		name = msg.message.user.name
		unless othername in ["who", "who all","Who", "Who all" , "i" , "I" , "i don't" , "i dont" , "i do not" , "I don't" , "I dont" , "I do not"]
			unless keyname not in ["red", "blue", "yellow", "green", "orange"]
				users = robot.brain.userForName othername
				if users is null
					key_holder = null
				else
					key_holder = users.name
				if key_holder is null
					if othername is 'you'
						msg.send "How am I supposed to take those #{keyname} keys? #{name} is a liar!"
					else if othername is robot.name
						msg.send "That's utter lies! How can you blame a bot to have the keys?"
					else
						msg.send "I don't know anyone by the name #{othername}"
				else
					if keyname is 'red'
						robot.brain.set("keyRed",key_holder)
					else if keyname is 'blue'
						robot.brain.set("keyBlue",key_holder)
					else if keyname is 'yellow'
						robot.brain.set("keyYellow",key_holder) 
					else if keyname is 'green'
						robot.brain.set("keyGreen",key_holder) 
					else if keyname is 'orange'
						robot.brain.set("keyOrange",key_holder) 
					msg.send "Okay, so now the #{keyname} keys are with #{othername}"	
    #4this section belongs to "i gave the keys to $name"
	robot.respond /(i|I) (have given the|had given the|have given|gave the|had given|gave) (.+) (key|keys) to (.+)/i , (msg)->
		othername = msg.match[5]
		keyname = msg.match[3]
		name = msg.message.user.name
		unless keyname not in ["red", "blue", "yellow", "green", "orange"]
			users = robot.brain.userForName othername
			if users is null
				key_holder = null
			else
				key_holder = users.name
			if key_holder is null
				if othername is 'you'
					msg.send "That's utter lies! How can you blame a bot to have the keys? #{name} is a liar!"
				else if othername is robot.name
					msg.send "That's utter lies! How can you blame a bot to have the keys?"
				else
					msg.send "I don't know anyone by the name #{othername}"
			else
				if keyname is 'red'
					robot.brain.set("keyRed",key_holder)	
				else if keyname is 'blue'
					robot.brain.set("keyBlue",key_holder)
				else if keyname is 'yellow'
					robot.brain.set("keyYellow",key_holder)
				else if keyname is 'green'
					robot.brain.set("keyGreen",key_holder)
				else if keyname is 'orange'
					robot.brain.set("keyOrange",key_holder)
				msg.send "Okay, so now the #{keyname} keys are with #{users.name}"
	
	#5this section is to print the details about the key holder.		
	robot.respond /who (has the|have the|has|have) (.+) (key|keys)/i , (msg)->
		keyname = msg.match[2]
		if keyname is 'red'
			key_holder = keyRed()
			msgText = key_holder
			if msgText is ""
				msg.send "Ah! Nobody informed me about the keys. Don't hold me responsible for this :expressionless:"
			else
				msgText+=" has red keys"
				msg.send msgText	
			robot.brain.set("keyRed" ,key_holder)
		else if keyname is 'blue'
			key_holder = keyBlue()
			msgText = key_holder
			if msgText is ""
				msg.send "Ah! Nobody informed me about the keys. Don't hold me responsible for this :expressionless:"
			else
				msgText+=" has blue keys"
				msg.send msgText	
			robot.brain.set("keyBlue" ,key_holder)
		else if keyname is 'yellow'
			key_holder = keyYellow()
			msgText = key_holder
			if msgText is ""
				msg.send "Ah! Nobody informed me about the keys. Don't hold me responsible for this :expressionless:"
			else
				msgText+=" has yellow keys"
				msg.send msgText	
			robot.brain.set("keyYellow" ,key_holder)
		else if keyname is 'green'
			key_holder = keyGreen()
			msgText = key_holder
			if msgText is ""
				msg.send "Ah! Nobody informed me about the keys. Don't hold me responsible for this :expressionless:"
			else
				msgText+=" has green keys"
				msg.send msgText	
			robot.brain.set("keyGreen" ,key_holder)
		else if keyname is 'orange'
			key_holder = keyOrange()
			msgText = key_holder
			if msgText is ""
				msg.send "Ah! Nobody informed me about the keys. Don't hold me responsible for this :expressionless:"
			else
				msgText+=" has orange keys"
				msg.send msgText	
			robot.brain.set("keyOrange" ,key_holder)
	robot.respond /who (has the|have the|has|have) (key|keys)/i , (msg)->
		key_holder1 = keyRed()
		key_holder2 = keyBlue()
		key_holder3 = keyYellow()
		key_holder4 = keyGreen() 
		key_holder5 = keyOrange()  		
		msgText=""
		if key_holder1 != ""
			msgText+=key_holder1
			msgText+=" has red keys.\n"
		if key_holder2 != ""
			msgText+=key_holder2
			msgText+=" has blue keys.\n"
		if key_holder3 != ""
			msgText+=key_holder3
			msgText+=" has yellow keys.\n"
		if key_holder4 != ""
			msgText+=key_holder3
			msgText+=" has green keys.\n"
		if key_holder5 != ""
			msgText+=key_holder3
			msgText+=" has orange keys.\n"
		if msgText is ""
			msg.send "Ah! Nobody informed me about any keys. Don't hold me responsible for this :expressionless:"
		else
			msg.send msgText
		robot.brain.set("keyRed" ,key_holder1)
		robot.brain.set("keyBlue" ,key_holder2)
		robot.brain.set("keyYellow" ,key_holder3)
		robot.brain.set("keyGreen" ,key_holder2)
		robot.brain.set("keyOrange" ,key_holder2)
    

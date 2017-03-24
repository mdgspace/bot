# Description:
#   Enlists all people who have given ++ or -- to a particular person

# Commands:
#   bot detailed score name

# Author:
# 	Pulkit Karira

module.exports = (robot) ->
	robot.respond /detailed score ([\w\-_]+)/i, (msg) ->
		# <keyword> whose score is to be shown
			name = msg.match[1]
			name = name.toLowerCase()
			plusField = []
			minusField = []
			detailedfield= robot.brain.get("detailedfield")
			response= ""
			if detailedfield[name]?
				if detailedfield[name]["plus"]?
					response+= "Appreciations\n"
					for  key , value of detailedfield[name]["plus"]
						plusField.push [key , value]
					plusField = plusField.map (val) -> "#{val[0]} : #{val[1]}\n"
					response+= plusField.join '\n'
				if detailedfield[name]["minus"]?
					response+= "\nDepreciations\n"
					for  key , value of detailedfield[name]["minus"]
						minusField.push [key , value]
					minusField = minusField.map (val) -> "#{val[0]} : #{val[1]}\n"
					response+= minusField.join '\n'
			else
				response+= "Sorry ! No such user"
			msg.send response



    			


  
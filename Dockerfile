FROM node:13

# Environment variables:

# Forces non-interactive mode for apt commands.
ENV DEBIAN_FRONTEND "noninteractive"

# Slack's bot name can be changed from the settings panel of Slack
ENV HUBOT_NAME "bot"
ENV HUBOT_OWNER "Mobile Development Group <mdg@iitr.ac.in>"
ENV HUBOT_SLACK_TEAM "mdgiitr"
ENV HUBOT_DESCRIPTION "Slack bot for Mobile Development Group, IIT Roorkee"
ENV TZ "Asia/Kolkata"
ENV FB_WAIT_MINUTES "1"
ENV IDLE_TIME_DURATION_HOURS "4"
ENV HUBOT_YOUTUBE_HEAR "true"

# Placeholder values for sensitive information.
# Actual values can be added to .env file which will override these.
ENV HUBOT_ENV_AUTH_TOKEN "env auth token"
ENV HUBOT_GOOGLE_CSE_ID "google id"
ENV HUBOT_GOOGLE_CSE_KEY "google key"
ENV HUBOT_GOOGLE_TRANSLATE_API_KEY "google translate api key"
ENV HUBOT_YOUTUBE_API_KEY "youtube key"
ENV REDIS_URL "redis://<Redis URL:PORT>/hubot" 
ENV HUBOT_SLACK_TOKEN "nope-1234-5678-91011-00e4dd"
ENV INFO_SPREADSHEET_URL "members spreadsheet"
ENV WAIL_PIC_URL "who all in lab"
ENV FB_APP_ACCESS_TOKEN "fb access token for random posts"
ENV FB_VERFIY_TOKEN "fb token"
ENV PORT "80"


# Add user
RUN useradd hubot -m
COPY . /home/hubot
# Make sure that the files have the right owner and group.
RUN chown -R hubot:hubot /home/hubot

USER hubot
WORKDIR /home/hubot

# Install dependencies.
RUN npm install

# Set a default command to run Hubot!
CMD ./bin/hubot -n $HUBOT_NAME -a slack

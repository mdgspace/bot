FROM node:8.10.0

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
ENV DEV_MODE "true"

ENV PORT "8080"

# Add user
RUN useradd hubot -m
COPY . /home/hubot
# Make sure that the files have the right owner and group.
RUN chown -R hubot:hubot /home/hubot

USER hubot
WORKDIR /home/hubot

# Set a default command to run Hubot!
# hubot calls npm install internally
CMD ./bin/hubot -n $HUBOT_NAME -a slack

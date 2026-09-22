FROM node:24.19.0-slim AS build

ENV NODE_ENV=development

WORKDIR /home/hubot

RUN chown node:node /home/hubot

COPY --chown=node:node package.json package-lock.json ./

USER node

RUN npm ci --omit=optional --legacy-peer-deps

COPY --chown=node:node tsconfig.json ./
COPY --chown=node:node src-ts ./src-ts

RUN npm run build \
  && npm prune --omit=dev --omit=optional --legacy-peer-deps

FROM node:24.19.0-slim AS runtime

ENV NODE_ENV=production \
    HUBOT_NAME=bot \
    HUBOT_OWNER="Mobile Development Group <mdg@iitr.ac.in>" \
    HUBOT_SLACK_TEAM=mdgiitr \
    HUBOT_DESCRIPTION="Slack bot for Mobile Development Group, IIT Roorkee" \
    TZ=Asia/Kolkata \
    FB_WAIT_MINUTES=1 \
    IDLE_TIME_DURATION_HOURS=4 \
    HUBOT_YOUTUBE_HEAR=true \
    PORT=8080

WORKDIR /home/hubot

COPY --from=build --chown=node:node /home/hubot/package.json /home/hubot/package-lock.json ./
COPY --from=build --chown=node:node /home/hubot/node_modules ./node_modules
COPY --from=build --chown=node:node /home/hubot/scripts ./scripts
COPY --chown=node:node bin ./bin
COPY --chown=node:node hubot-scripts.json ./

USER node

EXPOSE 8080

CMD ["sh", "-c", "exec ./node_modules/.bin/hubot -n \"${HUBOT_NAME:-bot}\" -a slack"]

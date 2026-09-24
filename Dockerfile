FROM node:24.19.0-slim AS build

ENV NODE_ENV=development

WORKDIR /home/bot

RUN chown node:node /home/bot

COPY --chown=node:node package.json package-lock.json ./

USER node

RUN npm ci --omit=optional --legacy-peer-deps

COPY --chown=node:node tsconfig.json ./
COPY --chown=node:node src-ts ./src-ts

RUN npm run build \
  && npm prune --omit=dev --omit=optional --legacy-peer-deps

FROM node:24.19.0-slim AS runtime

ENV NODE_ENV=production \
    BOT_NAME=bot \
    TZ=Asia/Kolkata \
    FB_WAIT_MINUTES=1 \
    IDLE_TIME_DURATION_HOURS=4 \
    HUBOT_YOUTUBE_HEAR=true \
    PORT=8080

WORKDIR /home/bot

COPY --from=build --chown=node:node /home/bot/package.json /home/bot/package-lock.json ./
COPY --from=build --chown=node:node /home/bot/node_modules ./node_modules
COPY --from=build --chown=node:node /home/bot/scripts ./scripts
COPY --chown=node:node bin ./bin

USER node

EXPOSE 8080

CMD ["node", "scripts/main.js"]

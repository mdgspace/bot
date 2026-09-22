#!/bin/bash

. ~/.nvm/nvm.sh
nvm install
nvm use
export HUBOT_NAME="bot"
export PORT=8080
set -a; source .env; set +a;
npm ci --omit=optional --legacy-peer-deps
npm run start

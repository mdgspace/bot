#!/bin/bash

nvm install 8.10.0
nvm use 8.10.0
export HUBOT_NAME="bot"
export PORT=8080
echo "helo"
set -a; source .env; set +a;
npm run start
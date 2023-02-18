#!/bin/bash

. ~/.nvm/nvm.sh
nvm install 8.10.0
nvm use 8.10.0
export HUBOT_NAME="bot"
export PORT=8080
set -a; source .env; set +a;
npm run start
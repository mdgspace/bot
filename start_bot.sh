#!/bin/bash

set -e
# Install dependencies and build during deployment, before invoking this script.
if [ ! -f scripts/main.js ]; then
  echo "Cannot launch bot: run npm ci --omit=optional --legacy-peer-deps and npm run build first." >&2
  exit 1
fi
if [ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ]; then
  . "${NVM_DIR:-$HOME/.nvm}/nvm.sh"
  nvm use
fi
exec npm run start

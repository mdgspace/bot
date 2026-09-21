#!/bin/bash

set -e
# Install dependencies and build during deployment, before invoking this script.
if [ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ]; then
  . "${NVM_DIR:-$HOME/.nvm}/nvm.sh"
  nvm use
fi
exec npm run start

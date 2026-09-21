# MDG Slack Bot

The Mobile Development Group Slack bot runs on [Bolt for JavaScript](https://docs.slack.dev/tools/bolt-js/) using Slack's HTTP Events API. The command implementations and persistent memory layout are retained from the previous runtime, but Hubot and `hubot-slack` are not runtime dependencies.

## Requirements

- Node.js 24.19.0 and npm 11.17.0 (`.nvmrc` selects the Node release)
- Redis
- A Slack app in the MDG workspace
- A public HTTPS endpoint which forwards `/slack/events` to port `8080`

## Slack app configuration

Create the new Slack app in the same workspace as the existing bot so stored Slack user IDs continue to identify the same people.

Configure these bot-token scopes:

- `app_mentions:read`
- `channels:history`
- `channels:read`
- `chat:write`
- `groups:read`
- `im:read`
- `mpim:read`
- `users:read`
- `users:read.email`

Enable Event Subscriptions and set the Request URL to:

```text
https://<public-host>/slack/events
```

Subscribe to these bot events:

- `app_mention`
- `message.channels`
- `user_change`

Install the app to the workspace and copy its bot token and signing secret. Socket Mode is not used, so `SLACK_APP_TOKEN` is not required.

## Configuration

Copy `.env.example` to `.env` and provide at least:

```dotenv
SLACK_BOT_TOKEN=xoxb-...
SLACK_SIGNING_SECRET=...
REDIS_URL=redis://localhost:6379
BOT_NAME=bot
PORT=8080
```

`HUBOT_NAME` and `HUBOT_ALIAS` remain accepted as compatibility fallbacks; new deployments should use `BOT_NAME` and `BOT_ALIAS`. Existing command-specific `HUBOT_*` variables remain unchanged because their script behavior is outside this framework migration.

The Redis URL selection order remains `REDISTOGO_URL`, `REDISCLOUD_URL`, `BOXEN_REDIS_URL`, then `REDIS_URL`. For compatibility with the existing brain, a URL path is treated as the key prefix in Redis database 0. For example, `redis://cache:6379/mdg` reads and writes `mdg:storage`. With no path, the key remains `hubot:storage`.

## Running locally

```shell
nvm install
nvm use
npm ci --omit=optional --legacy-peer-deps
npm run build
npm start
```

`npm start` runs the Bolt entrypoint at `scripts/main.js`; its `prestart` hook recompiles TypeScript. The standalone launchers also install, build, validate, and start the app:

```shell
./bin/bot
bin\bot.cmd
```

The old `bin/hubot` and `bin/hubot.cmd` paths forward to these Bolt launchers for deployment compatibility. They do not load Hubot.

For watch mode, use `npm run dev`. It connects to the configured Slack and Redis services; there is no shell adapter in Bolt.

## Deployment paths

All existing deployment paths remain supported:

- `start_bot.sh` loads `.env`, performs a locked install, and runs the app.
- `Procfile` starts a `web` process so the Events API route receives traffic.
- `Dockerfile` builds TypeScript in a separate stage and starts `scripts/main.js` as the unprivileged `node` user.
- `docker-compose.yml` loads production configuration from `.env` and publishes container port `8080` on `127.0.0.1:9998`.
- `dev_docker-compose.yml` additionally starts Redis and sets the bot's Redis hostname.

Example Docker commands:

```shell
docker build . -t mdg-bot:latest
docker run --rm --env-file .env -p 127.0.0.1:9998:8080 mdg-bot:latest
```

The reverse proxy must forward the public `/slack/events` URL to the published port without rewriting the request body. Bolt verifies the Slack signature before acknowledging an event.

## Persistent environment commands

The former `hubot-env` commands are implemented locally and keep the existing `_private["hubot-env"]` brain data:

- `bot env current [--prefix=PREFIX]`
- `bot env file`
- `bot env load --filename=FILE [--dry-run]`
- `bot env flush all [--dry-run]`

Slack credentials are always redacted from command output. Add other sensitive key fragments to the comma-separated `HUBOT_ENV_HIDDEN_WORDS` setting.

## Verification

```shell
npm run check
```

The test suite uses fake Slack and Redis clients. It does not connect to a Slack workspace.

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
- `im:write` (opening DMs for scripts that explicitly send to a user)
- `users:read`

Enable Event Subscriptions and set the Request URL to:

```text
https://<public-host>/slack/events
```

Subscribe to these bot events:

- `app_mention`
- `message.channels`
- `user_change`

Install the app to the workspace and copy its bot token and signing secret. Then invite the new bot to every public channel where it must receive events or post messages, including `#general` and any scheduled-message destinations:

```text
/invite @<new-app-bot-name>
```

Installing an app does not automatically join its bot to channels. With the documented `message.channels` event and `chat:write` scope, channel membership is required for the bot's normal event and posting flow. Socket Mode is not used, so `SLACK_APP_TOKEN` is not required.

## Configuration

Copy `.env.example` to `.env` and provide at least:

```dotenv
SLACK_BOT_TOKEN=xoxb-...
SLACK_SIGNING_SECRET=...
REDIS_URL=redis://localhost:6379
BOT_NAME=bot
PORT=8080
BOT_ADMIN_IDS=U0123456789
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

`npm start` runs the previously built Bolt entrypoint at `scripts/main.js`. Run the locked install and build above after changing code or dependencies. Startup does not install packages or compile code. The standalone launchers validate the build and start the app:

```shell
./bin/bot
bin\bot.cmd
```

The old `bin/hubot` and `bin/hubot.cmd` paths forward to these Bolt launchers for deployment compatibility. They do not load Hubot.

For watch mode, use `npm run dev`. It connects to the configured Slack and Redis services; there is no shell adapter in Bolt.

Local npm commands and standalone launchers automatically load `.env`; already exported variables take precedence.

## Deployment paths

All existing deployment paths remain supported:

- `start_bot.sh` runs the prepared build through `npm start`, which loads `.env`.
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

Production Compose does not provision Redis. Set `REDIS_URL` (or a higher-precedence provider variable) to a Redis host reachable **from the container**; `localhost` refers to the bot container, not the Docker host. Keep the existing Redis key prefix to preserve memory. Use Redis persistence and a non-evicting policy for the brain and inbox.

Run **one active bot instance** against a brain, including during cutover; stop the old bot before starting the replacement. Accepted events are written to a Redis inbox before HTTP acknowledgement. Workers process channels independently, retain transient failures with backoff, and replay pending work after restart. A crash between a script's external side effect and inbox completion can repeat that side effect: inbox processing is at-least-once, not exactly-once. Script callbacks and outbound sends are not transactional with inbox completion. Redis durability depends on its persistence configuration. Monitor inbox backlog and error logs for persistent credential/scope failures.

As in the old middleware, incoming DM/private-channel commands are disabled. Thread replies retain the old adapter's thread context. Text on `file_share` messages now reaches listeners; edited/deleted/hidden messages remain excluded. Outbound text is split into 4,000-character chunks, with ordering per destination; send failures are logged. Legacy external command endpoints are unchanged: the HTTP helper follows redirects and fails after 15 seconds, but unavailable third-party services still require an operator-selected replacement.

`natural` and `node-cron` are pinned to the baseline installed versions to preserve tokenizer imports and named-day schedules. The obsolete quote HTML parsers have been replaced without changing the quote command format.

## Persistent environment commands

The former `hubot-env` commands are implemented locally and keep the existing `_private["hubot-env"]` brain data:

- `bot env current [--prefix=PREFIX]`
- `bot env file`
- `bot env load --filename=FILE [--dry-run]`
- `bot env flush all [--dry-run]`

All `env` commands, `show users`, `show storage`, and `die` require a human Slack user ID in the operator-configured, comma-separated `BOT_ADMIN_IDS`. With no IDs configured they are disabled. Chat-editable roles do not grant this access. `die` requests graceful shutdown; the deployment's restart policy still applies.

Set `HUBOT_ENV_BASE_PATH` to a dedicated directory containing only files administrators may load. `env load` rejects paths and symlinks outside it. Administrator IDs, the base directory, and Node startup settings cannot be changed through persisted environment commands; change those in deployment configuration and restart.

Credential-like keys (including keys, URLs, passwords, and auth values) are redacted from environment/storage output. `show users` omits emails, and fresh Slack profiles do not collect emails. Existing brain data is retained. Add project-specific sensitive key fragments to `HUBOT_ENV_HIDDEN_WORDS` for environment output. Authorized diagnostic output still goes to the invoking channel: use it only where the remaining data may be shared.

## Verification

```shell
npm run check
```

The test suite uses fake Slack and Redis clients. It does not connect to a Slack workspace.

CI additionally runs `npm run test:redis` with `TEST_REDIS_URL=redis://127.0.0.1:6379` against a disposable Redis service to verify the actual inbox Lua operations. This opt-in test accepts only loopback hosts and deletes only its own randomly named keys.

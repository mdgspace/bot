@echo off
setlocal

if not exist scripts\main.js (
  echo Cannot launch bot: run npm ci --omit=optional --legacy-peer-deps and npm run build first. 1>&2
  exit /b 1
)

:parse_arguments
if "%~1"=="" goto launch
if /I "%~1"=="-n" goto bot_name
if /I "%~1"=="--name" goto bot_name
if /I "%~1"=="-a" goto adapter
if /I "%~1"=="--adapter" goto adapter
echo Unknown launcher argument: %~1 1>&2
exit /b 1

:bot_name
if "%~2"=="" (
  echo Missing bot name after %~1 1>&2
  exit /b 1
)
set "BOT_NAME=%~2"
shift
shift
goto parse_arguments

:adapter
if /I not "%~2"=="slack" (
  echo Bolt supports only the Slack adapter. 1>&2
  exit /b 1
)
shift
shift
goto parse_arguments

:launch
node --env-file-if-exists=.env scripts\main.js
exit /b %errorlevel%

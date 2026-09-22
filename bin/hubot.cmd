@echo off

call npm install --legacy-peer-deps
if errorlevel 1 exit /b 1

call npm run build
if errorlevel 1 exit /b 1

if not exist scripts\*.js (
  echo Cannot launch Hubot: no compiled JavaScript files were found in scripts/. 1>&2
  exit /b 1
)

call node_modules\.bin\hubot.cmd %*
exit /b %errorlevel%

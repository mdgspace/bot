@echo off
rem Backward-compatible path; bot.cmd launches Bolt, not Hubot.
call "%~dp0bot.cmd" %*
exit /b %errorlevel%

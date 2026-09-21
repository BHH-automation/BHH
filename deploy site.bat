@echo off
setlocal
cd /d "%~dp0"
echo ==========================================
echo  Deploying the British Heritage Hosts site
echo ==========================================
echo.
git add -A
if errorlevel 1 goto failed
git --no-pager diff --cached --quiet
if not errorlevel 1 goto checksaved
echo Files about to be sent (new files are now included):
git --no-pager diff --cached --name-only
echo.
git commit -m "Site update %DATE% %TIME%"
if errorlevel 1 goto failed
goto send
:checksaved
rem Changes already saved by preview site.bat are committed but not yet
rem published. Send them too, instead of stopping with nothing to do.
set AHEAD=0
for /f %%n in ('git rev-list --count origin/main..HEAD') do set AHEAD=%%n
if "%AHEAD%"=="0" goto nochange
echo No new edits, but %AHEAD% saved preview changes are not live yet. Sending them now.
echo.
:send
git push origin HEAD:main
if errorlevel 1 goto failed
echo.
echo Sent. Netlify publishes the new version in about a minute.
goto done
:nochange
echo Nothing has changed since the last deploy, so nothing was sent.
goto done
:failed
echo.
echo SOMETHING WENT WRONG. Read the message above and send it to Claude.
:done
echo.
pause

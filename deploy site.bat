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
if not errorlevel 1 goto nochange
echo Files about to be sent (new files are now included):
git --no-pager diff --cached --name-only
echo.
git commit -m "Site update %DATE% %TIME%"
if errorlevel 1 goto failed
git push
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

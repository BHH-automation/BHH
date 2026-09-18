@echo off
setlocal
cd /d "%~dp0"
echo ==========================================
echo  FREE PREVIEW BUILD
echo  This does NOT touch the live site.
echo ==========================================
echo.
git add -A
if errorlevel 1 goto failed
git diff --cached --quiet
if not errorlevel 1 goto nochange
echo Files going into this preview:
git diff --cached --name-only
echo.
git commit -m "Preview %DATE% %TIME%"
if errorlevel 1 goto failed
:push
echo Sending to the preview branch...
git push -f origin HEAD:preview
if errorlevel 1 goto failed
echo.
echo Sent. Netlify builds it in about a minute and it costs no credits.
echo.
echo Open this on your phone or your desktop:
echo   https://preview--stirring-granita-fb5828.netlify.app/
echo.
echo Your live site at britishheritagehosts.com is unchanged.
goto done
:nochange
echo Nothing has changed since last time. Sending the current version anyway.
goto push
:failed
echo.
echo SOMETHING WENT WRONG. Read the message above and send it to Claude.
:done
echo.
pause

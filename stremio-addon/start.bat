@echo off
echo ==========================================
echo Vidstorm Stremio Addon Launcher
echo ==========================================
echo.
echo Starting both servers...
echo - Video Proxy: http://127.0.0.1:7001
echo - Stremio Addon: http://localhost:7000
echo.

:: Start the video proxy server in a new window
start "Video Proxy (Port 7001)" cmd /c "start-proxy.bat"

:: Wait for proxy to initialize
echo Waiting for proxy to start...
timeout /t 3 /nobreak > nul

:: Start the addon server in this window
echo Starting Stremio Addon...
node addon.js

echo.
echo Press any key to stop all servers...
pause > nul
taskkill /f /im node.exe > nul 2>&1
echo Servers stopped.

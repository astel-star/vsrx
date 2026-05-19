@echo off
echo ==========================================
echo Vidstorm Pre-Fetch Proxy Server
echo ==========================================
echo.
echo This proxy pre-fetches HLS segments to reduce
echo time-to-first-frame for Stremio player.
echo.
echo Features:
echo   - Detects playlist requests
echo   - Pre-fetches first 5 segments
echo   - Serves cached segments instantly
echo.
echo Press Ctrl+C to stop the proxy.
echo.
node prefetch-proxy.js
pause

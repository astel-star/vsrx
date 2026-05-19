@echo off
echo ==========================================
echo Vidstorm MediaFlow Proxy Server
echo ==========================================
echo.
echo This proxy uses MediaFlow-style handling
echo for better Stremio HLS compatibility.
echo.
echo Features:
echo   - MediaFlow-style proxyHeaders
echo   - Proper HLS playlist handling
echo   - TikTok CDN segment proxying
echo.
echo Press Ctrl+C to stop the proxy.
echo.
node mediaflow-proxy.js
pause

@echo off
REM Abre una pantalla de Dicen en Chrome, en modo kiosco y con autoplay habilitado.
REM Uso: kiosk-windows.bat screen1 [ip-del-servidor] [puerto]
set SCREEN=%1
if "%SCREEN%"=="" set SCREEN=screen1
set HOST=%2
if "%HOST%"=="" set HOST=localhost
set PORT=%3
if "%PORT%"=="" set PORT=8080

set CHROME=C:\Program Files\Google\Chrome\Application\chrome.exe
if not exist "%CHROME%" set CHROME=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe

start "" "%CHROME%" --kiosk --autoplay-policy=no-user-gesture-required --noerrdialogs --disable-session-crashed-bubble --disable-infobars --user-data-dir="%TEMP%\dicen-%SCREEN%" http://%HOST%:%PORT%/%SCREEN%

@echo off
REM Abre una pantalla de Dicen en Chrome, en modo kiosco y con autoplay habilitado.
REM El video se lee siempre de ESTA PC (servidor local); por la red solo viaja el estado.
REM Uso: kiosk-windows.bat screen1 [ip-del-servidor-de-estado] [puerto]
REM   - En la PC que es servidor de estado: kiosk-windows.bat screen1
REM   - En la otra PC:                      kiosk-windows.bat screen2 192.168.0.10
set SCREEN=%1
if "%SCREEN%"=="" set SCREEN=screen1
set STATE=%2
set PORT=%3
if "%PORT%"=="" set PORT=8080

set URL=http://localhost:%PORT%/%SCREEN%
if not "%STATE%"=="" if /i not "%STATE%"=="localhost" set URL=%URL%?servidor=%STATE%:%PORT%

set CHROME=C:\Program Files\Google\Chrome\Application\chrome.exe
if not exist "%CHROME%" set CHROME=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe

start "" "%CHROME%" --kiosk --autoplay-policy=no-user-gesture-required --noerrdialogs --disable-session-crashed-bubble --disable-infobars --user-data-dir="%TEMP%\dicen-%SCREEN%" "%URL%"

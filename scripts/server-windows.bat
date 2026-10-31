@echo off
REM Arranca el servidor de Dicen y lo reinicia si se cierra.
cd /d "%~dp0.."
:loop
if exist .env (node --env-file=.env server.js) else (node server.js)
echo El servidor se cerro. Reiniciando en 3 segundos...
timeout /t 3 /nobreak >nul
goto loop

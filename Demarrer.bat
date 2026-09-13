@echo off
title Demenagement - serveur cartons
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js est introuvable. Installe-le depuis https://nodejs.org puis relance ce fichier.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Premiere installation des dependances...
  call npm install
)

start "" http://localhost:3000
node server/index.js
pause

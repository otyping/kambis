@echo off
title Kambis Dashboard
rem Double-click this file to start the dashboard server.
rem All Thai text lives in scriptsstart-dashboard.ps1 because batch files
rem garble non-ASCII depending on the machine codepage.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scriptsstart-dashboard.ps1"

pause

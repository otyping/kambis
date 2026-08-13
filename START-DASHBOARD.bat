@echo off
title Kambis Dashboard
rem Double-click this file to start the dashboard server.
rem Thai text lives in scripts\start-dashboard.ps1 because batch files
rem garble non-ASCII depending on the machine codepage.
rem This file must stay ASCII-only with CRLF line endings.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-dashboard.ps1"

pause

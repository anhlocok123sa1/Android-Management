@echo off
chcp 65001 >nul
title SGL Smart Broadcast Cloud - Web Quan Tri Android
cd /d "%~dp0"
python web_server.py
pause

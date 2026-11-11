@echo off
chcp 65001 >nul
title SGL SMART BROADCAST - POCKETBASE BACKEND
cd /d "%~dp0"
python CHAY_POCKETBASE.py
pause

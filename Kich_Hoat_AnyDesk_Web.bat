@echo off
chcp 65001 >nul
title Kich Hoat Mo AnyDesk Tu Web (SGL Management)
echo ============================================================
echo   SGL SMART BROADCAST - KICH HOAT GIAO THUC ANYDESK TREN WEB
echo ============================================================
echo.
echo Dang kiem tra file AnyDesk.exe tren may tinh cua ban...

set "ANYDESK_PATH="

REM 1. Kiem tra thu muc Downloads
if exist "%USERPROFILE%\Downloads\AnyDesk.exe" set "ANYDESK_PATH=%USERPROFILE%\Downloads\AnyDesk.exe"
if exist "%USERPROFILE%\Downloads\anydesk.exe" set "ANYDESK_PATH=%USERPROFILE%\Downloads\anydesk.exe"

REM 2. Kiem tra thu muc cai dat chuan
if exist "%ProgramFiles(x86)%\AnyDesk\AnyDesk.exe" set "ANYDESK_PATH=%ProgramFiles(x86)%\AnyDesk\AnyDesk.exe"
if exist "%ProgramFiles%\AnyDesk\AnyDesk.exe" set "ANYDESK_PATH=%ProgramFiles%\AnyDesk\AnyDesk.exe"
if exist "%LocalAppData%\AnyDesk\AnyDesk.exe" set "ANYDESK_PATH=%LocalAppData%\AnyDesk\AnyDesk.exe"
if exist "%AppData%\AnyDesk\AnyDesk.exe" set "ANYDESK_PATH=%AppData%\AnyDesk\AnyDesk.exe"

REM 3. Kiem tra man hinh Desktop
if exist "%USERPROFILE%\Desktop\AnyDesk.exe" set "ANYDESK_PATH=%USERPROFILE%\Desktop\AnyDesk.exe"

if "%ANYDESK_PATH%"=="" (
    echo.
    echo [!] CHUA TIM THAY FILE AnyDesk.exe!
    echo Vui long chac chan ban da tai AnyDesk ve thu muc Downloads (hoac de tren Desktop).
    echo Sau do hay chay lai file nay.
    echo.
    pause
    exit /b 1
)

echo.
echo [OK] Da tim thay AnyDesk tai:
echo      "%ANYDESK_PATH%"
echo.
echo Dang dang ky giao thuc anydesk: vao Windows Registry...

reg add "HKCU\Software\Classes\anydesk" /ve /d "URL:AnyDesk Protocol" /f >nul
reg add "HKCU\Software\Classes\anydesk" /v "URL Protocol" /d "" /f >nul
reg add "HKCU\Software\Classes\anydesk\shell\open\command" /ve /d "\"%ANYDESK_PATH%\" \"%%1\"" /f >nul

echo.
echo ============================================================
echo   DA KICH HOAT THANH CONG!
echo.
echo   Tu bay gio, khi ban bam nut [💻 AnyDesk] tren trang web
echo   https://anhlocok123sa1.github.io/Android-Management/
echo   trinh duyet se tu dong bat AnyDesk len de ket noi toi Box.
echo ============================================================
echo.
pause

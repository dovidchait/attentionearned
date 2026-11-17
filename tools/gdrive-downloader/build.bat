@echo off
REM Local build of GDriveDownloader.exe (Windows only).
REM CI builds the same thing: .github/workflows/build-gdrive-downloader.yml
title Build GDriveDownloader.exe
cd /d "%~dp0"
echo ========================================
echo   Building GDriveDownloader.exe
echo ========================================
echo.

python --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Python not found. Install from https://python.org and re-run.
    pause
    exit /b 1
)

echo Installing PyInstaller...
python -m pip install --upgrade pyinstaller --quiet
if errorlevel 1 (
    echo ERROR: pip install failed.
    pause
    exit /b 1
)

echo.
echo Building exe (this takes ~30 seconds)...
python -m PyInstaller --onefile --windowed --name GDriveDownloader --clean --noconfirm gdrive_downloader.py
if errorlevel 1 (
    echo.
    echo ERROR: Build failed. See above for details.
    pause
    exit /b 1
)

echo.
echo ========================================
echo   Done! Your exe is at:
echo   %~dp0dist\GDriveDownloader.exe
echo ========================================
echo.
pause

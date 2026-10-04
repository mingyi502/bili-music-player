@echo off
setlocal
cd /d "%~dp0"
title bili-music-player (USB 模式)

echo ============================================
echo   bili-music-player - USB 模式
echo ============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 未检测到 Node.js。
  echo 请先安装 Node.js 20 或更高版本: https://nodejs.org/
  echo.
  pause
  exit /b 1
)

where adb >nul 2>nul
if errorlevel 1 (
  echo [错误] 未检测到 adb。
  echo 请安装 Android Studio（自带 adb），或单独安装 Android Platform Tools，
  echo 并把 adb.exe 加入 PATH 后重试。
  echo 下载: https://developer.android.com/tools/releases/platform-tools
  echo.
  pause
  exit /b 1
)

if not exist "node_modules\vite" (
  echo [1/3] 首次运行, 正在安装依赖, 请稍候...
  call npm install --no-audit --no-fund
  if not exist "node_modules\vite" (
    echo [错误] 依赖安装失败, 请检查网络后重试。
    pause
    exit /b 1
  )
) else (
  echo [1/3] 依赖已安装, 跳过。
)

echo [2/3] 检查手机连接...
adb get-state 1>nul 2>nul
if errorlevel 1 (
  echo.
  echo [错误] 未检测到已连接的手机。
  echo   1. 用 USB 线连接手机
  echo   2. 手机「设置 - 关于手机」连点版本号开启开发者选项
  echo   3. 开发者选项里打开「USB 调试」，并在手机上允许本电脑调试
  echo.
  pause
  exit /b 1
)

echo       已检测到设备，正在建立端口转发 localhost:5173 -^> 本机 5173
adb reverse tcp:5173 tcp:5173
if errorlevel 1 (
  echo [错误] adb reverse 失败，请确认手机已授权本电脑。
  pause
  exit /b 1
)

echo [3/3] 正在启动服务...
echo.
echo   * 服务仍只监听本机，不开放局域网，因此不需要访问口令
echo   * 在手机浏览器打开: http://localhost:5173
echo   * 关掉本窗口即停止服务（端口转发也会失效）
echo.

call npm run start

echo.
echo 服务已停止。
pause

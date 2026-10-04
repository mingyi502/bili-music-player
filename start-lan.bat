@echo off
setlocal
cd /d "%~dp0"
title bili-music-player (局域网模式)

echo ============================================
echo   bili-music-player - 局域网模式
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

if not exist "node_modules\vite" (
  echo [1/2] 首次运行, 正在安装依赖, 请稍候...
  call npm install --no-audit --no-fund
  if not exist "node_modules\vite" (
    echo.
    echo [错误] 依赖安装失败, 请检查网络后重试。
    pause
    exit /b 1
  )
) else (
  echo [1/2] 依赖已安装, 跳过。
)

echo [2/2] 正在以【局域网模式】启动服务...
echo.
echo   * 启动后终端会显示一串「访问口令」
echo   * 手机与电脑必须在同一个 Wi-Fi
echo   * 手机浏览器打开终端里显示的 http://192.168.x.x:5173
echo   * 首次打开需要输入那串访问口令
echo   * 关闭本窗口即停止服务
echo.

set BMP_LAN=1
call npm run start

echo.
echo 服务已停止。
pause

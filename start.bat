@echo off
setlocal
cd /d "%~dp0"
title QQ音乐 x 哔哩哔哩 播放器

echo ============================================
echo   QQ音乐 x 哔哩哔哩 播放器
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

for /f "tokens=*" %%v in ('node -v') do echo Node.js 版本: %%v
echo.

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

echo [2/2] 正在启动服务并自动打开浏览器...
echo.
echo 关闭此窗口即可停止服务。
echo.

call npm run start

echo.
echo 服务已停止。
pause

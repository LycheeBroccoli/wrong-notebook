@echo off
REM wrong-notebook-LB-deploy (3000) 强制停止脚本
REM 用途：当 Ctrl+C 没杀干净、3000 端口仍被占用报 EADDRINUSE 时使用

echo 正在查找占用 3000 端口的进程...
for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTENING"') do (
    echo 发现占用进程 PID=%%P，正在终止...
    taskkill /PID %%P /F
    goto done
)
echo 未发现占用 3000 端口的进程，无需清理。
:done
pause

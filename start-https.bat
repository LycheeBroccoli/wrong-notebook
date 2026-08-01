@echo off
REM wrong-notebook HTTPS 启动入口（Next 3000 + HTTPS 代理 443）
cd /d "%~dp0"
node scripts\deploy\start-production.mjs
pause
@echo off
REM wrong-notebook HTTP 启动入口（仅 Next 3000，无 HTTPS）
cd /d "%~dp0"
REM 走公司代理访问 Gemini API（PAC: http://proxy.hikvision.com.cn/proxy.pac 解析出的实际代理）
set HTTPS_PROXY=http://proxy.hikvision.com.cn:8080
set HTTP_PROXY=http://proxy.hikvision.com.cn:8080
REM 内网地址绕过代理（避免把内部服务也塞进外网代理）
set NO_PROXY=localhost,127.0.0.1,10.0.0.0/8,.hikvision.com.cn
REM 如需在日志里看到 "Global Undici dispatcher set"，可临时取消下一行注释（仅调试用，平时保持注释）
REM set NODE_ENV=development
npm start
pause

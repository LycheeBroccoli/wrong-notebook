# wrong-notebook Windows 本地生产部署

部署目录：`E:\2026_wrong-notebook-LB-deploy`
访问：`https://localhost`（首次点"高级→继续访问"）或 HTTP 备选 `http://localhost:3000`
默认管理员：`admin@localhost` / `123456`

## 一次性初始化

在源码仓库 `E:\2026_wrong-notebook-LB` 完成脚本开发后，部署目录执行：

```bat
REM 1. 复制源码（在源码仓库根目录运行，排除运行时目录）
robocopy E:\2026_wrong-notebook-LB E:\2026_wrong-notebook-LB-deploy /E /XD node_modules .git .next data .next-prebuilt dist-scripts certs /XF *.log

REM 2. 进入部署目录
cd /d E:\2026_wrong-notebook-LB-deploy

REM 3. 安装依赖（含 selfsigned）
npm ci

REM 4. 生成 .env
node scripts\deploy\generate-env.mjs

REM 5. 生成自签证书
node scripts\deploy\generate-cert.mjs

REM 6. 初始化数据库（迁移 + 条件 seed）
node scripts\deploy\init-db.mjs

REM 7. 生产构建
npm run build
```

## 日常启动

- HTTPS：双击 `start-https.bat`（或 `node scripts\deploy\start-production.mjs`）
- HTTP 备选：双击 `start-http.bat`（或 `npm start`）

关闭：在启动窗口按 `Ctrl+C`，启动器会同时关闭 Next 与 HTTPS 代理。

## 常见问题

**Q：浏览器提示 `NET::ERR_CERT_AUTHORITY_INVALID`**
A：自签证书正常现象。首次访问 `https://localhost` → 点"高级" → "继续访问"。

**Q：HTTP `http://localhost:3000` 正常，但 `https://localhost`（443）不通不了**
A：检查
1. `.env` 是否存在且 `CERT_DIR` 指向部署目录的 `certs`
2. `certs\cert.pem` 与 `certs\key.pem` 是否存在
3. `start-production.mjs` 是否成功加载 `.env`（看启动日志有无 `[start]` 行）
4. 443 端口是否被其他程序占用

**Q：Ctrl+C 后进程残留**
A：极端情况下 Windows 信号传递失败，用 `taskkill /F /IM node.exe` 清理。

**Q：端口被占**
A：3000 或 443 被占时，改 `.env` 的 `PORT`（Next）或 `HTTPS_PORT`（HTTPS 代理，需 `https-server.js` 支持，默认 443）。

**Q：重新初始化会重置管理员密码吗**
A：不会。`init-db.mjs` 检测到 `admin@localhost` 已存在则跳过 seed。

## AI 配置

部署后登录管理员账户，进入"设置"配置 AI 提供商（Gemini / OpenAI / Azure）。配置写入 `config\app-config.json`，优先级高于 `.env`。
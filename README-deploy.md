# wrong-notebook Windows 本地生产部署

部署目录：`E:\2026_wrong-notebook-LB-deploy`
访问：`https://localhost`（首次点"高级→继续访问"）或 HTTP 备选 `http://localhost:3000`
默认管理员：`admin@localhost` / `123456`

## 开发与版本管理

本目录是主开发工作区，代码连接 `LycheeBroccoli/wrong-notebook`。LB 目录仅保留历史归档，不再向本目录复制源码。正式数据库、运行配置和证书保持本地，不提交 GitHub。

整合阶段使用 `integration/deploy-baseline`，通过草稿 PR 审核；审核合并前不更新 main。日常改动使用功能分支，测试、构建和 E2E 在独立 worktree 中运行，使用独立数据库和端口，禁止复用正式服务。

数据备份和恢复见 [私人数据备份说明](docs/private-backups.md)。更新应用之前先备份，在短暂停机窗口构建、启动；不要在已有错题库上重新执行初始化或 seed。

## 仅适用于全新安装的初始化

以下命令仅用于没有正式数据的新安装，不适用于现有 deploy 的整合和更新：

```bat
REM 1. 使用 Git 获取经过审核的代码，不复制旧 LB 目录覆盖本地文件
git clone https://github.com/LycheeBroccoli/wrong-notebook.git E:\wrong-notebook-new-install

REM 2. 进入部署目录
cd /d E:\wrong-notebook-new-install

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

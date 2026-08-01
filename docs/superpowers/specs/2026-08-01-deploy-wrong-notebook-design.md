# Windows 本地生产部署设计 — wrong-notebook

- 日期：2026-08-01
- 目标：在 `E:\2026_wrong-notebook-LB-deploy` 部署 wrong-notebook（Next.js 16 + Prisma + SQLite），本地源码构建运行，启用内置 HTTPS，不依赖 Docker。
- 源码来源：当前仓库 `E:\2026_wrong-notebook-LB`（含本地改动）。
- 设计原则：尽量不改源码、贴近 Docker 生产形态、迁移 Docker 零成本、跨平台、可长期维护。

## 环境前提

- Windows 11，Git Bash。
- Node v24.13.1、npm 11.8.0 已就绪。
- 未安装 Docker（本方案不依赖）。
- `package-lock.json` 存在 → 用 `npm ci`。
- Prisma `binaryTargets = ["native", "linux-musl-openssl-3.0.x"]`，`native` 覆盖 Windows，`npm ci` 会为本机构建 better-sqlite3 原生绑定。
- `next.config.ts` 已设 `output: 'standalone'`，但本地用 `npm run build` + `npm start` 即可，不依赖 standalone 产物。
- `https-server.js` 第 14 行默认 `CERT_DIR='/app/certs'`（Docker 路径），本地必须通过 `CERT_DIR` 环境变量指向 Windows 路径。

## 目录结构

```
E:\2026_wrong-notebook-LB-deploy\
├── src/, prisma/, public/, scripts/, config/, package.json, package-lock.json, ...  # 源码副本
├── .env                                          # generate-env.mjs 生成（已存在则跳过）
├── certs\
│   ├── cert.pem                                  # generate-cert.mjs 生成（含 SAN）
│   └── key.pem
├── prisma\dev.db                                 # migrate deploy 生成
├── scripts\deploy\                               # 新增部署辅助脚本
│   ├── generate-env.mjs
│   ├── generate-cert.mjs
│   └── start-production.mjs
├── start-https.bat                                # 调用 start-production.mjs
├── start-http.bat                                 # 备选：仅 npm start，HTTP 3000
└── README-deploy.md
```

复制排除：`node_modules .git .next data .next-prebuilt dist-scripts certs prisma\dev.db *.log`。
（`certs/` 与 `prisma/dev.db` 在源码中本就不存在，写进排除列表仅为显式与稳健。）

## 一次性初始化流程

1. **robocopy 复制源码** 到部署目录，排除上述目录/文件。
2. **`npm ci`** —— 严格按 lockfile 安装，含 devDependencies（selfsigned 在内）。初始化阶段不带 `--omit=dev`。
3. **`node scripts/deploy/generate-env.mjs`** —— 生成 `.env`；若已存在则跳过并提示，避免覆盖已填的 AI Key / 管理员配置。
4. **`node scripts/deploy/generate-cert.mjs`** —— 用 `selfsigned` 生成自签证书到 `certs/`，SAN 含 `DNS:localhost`、`IP:127.0.0.1`、`IP:::1`。不手写 X.509，不要 openssl fallback。
5. **`npx prisma migrate deploy`** —— 应用 10 个迁移，自动创建 `prisma/dev.db`。生产命令，不重置数据库。
6. **admin 存在性检查 + seed** —— 先查 `admin@localhost` 是否存在；存在则跳过 `db seed`，避免重置密码；不存在则 `npx prisma db seed` 创建（`admin@localhost` / `123456`）。
7. **`npm run build`** —— 生产构建。

## .env 内容

```
DATABASE_URL="file:./dev.db"
NEXTAUTH_SECRET=<crypto.randomBytes(32).toString('hex')>
AUTH_TRUST_HOST=true
HTTPS_ENABLED=true
CERT_DIR=E:\2026_wrong-notebook-LB-deploy\certs
CERT_DOMAIN=localhost
LOG_LEVEL=info
```

AI 相关（`AI_PROVIDER`、`GOOGLE_API_KEY`、`OPENAI_*` 等）留空，部署后在网页"设置"里配置，写入 `config/app-config.json`（优先级高于 .env）。

### DATABASE_URL 路径说明

保持 `file:./dev.db`，**不改**为 `file:./prisma/dev.db`。Prisma 对 SQLite 的 `file:` 路径相对于 `schema.prisma` 所在目录（`prisma/`）解析，故 `file:./dev.db` 实际即 `prisma/dev.db`。证据：`.env.example` 第 3 行注释、`docker-entrypoint.sh` 中 `SOURCE_DB="/app/prisma/dev.db"`。若写 `file:./prisma/dev.db` 会解析为 `prisma/prisma/dev.db`，错误。

## 证书生成

- 库：`selfsigned`（纯 JS、跨平台、无 OpenSSL 依赖），放入 `devDependencies`，随 `npm ci` 安装。
- `generate-cert.mjs` 仅依赖 `selfsigned`，无 fallback。
- SAN：`DNS:localhost`、`IP:127.0.0.1`、`IP:::1`，覆盖 `https://localhost` 与 `https://127.0.0.1` 访问。
- 有效期 10 年。

## 日常启动

`start-https.bat` → `node scripts/deploy/start-production.mjs`

`start-production.mjs` 职责：
1. `require('dotenv').config()` 加载 `.env`，子进程继承 env，统一 `CERT_DIR/HTTPS_ENABLED/LOG_LEVEL/PORT` 来源，bat 不再 `set` 任何变量。
2. spawn `npm start`（Next 生产服务器，3000）。
3. **轮询就绪**：循环请求 `http://127.0.0.1:3000`，2xx/3xx/404 视为 ready；不 sleep 固定时间，适应不同机器/build 大小。
4. ready 后 spawn `node https-server.js`（443 代理 → 127.0.0.1:3000）。
5. **统一退出**：监听 `SIGINT`、`SIGTERM`、`exit`、`uncaughtException`、`unhandledRejection`，任一触发都 kill 两个子进程，Ctrl+C 干净退出（应对 Windows 下 Ctrl+C 偶尔不传递给 `npm.cmd` 子进程）。
6. 子进程意外退出（如 Next 崩溃）时，启动器记录并退出，避免 HTTPS 代理空转返回 502 而用户不知情。

## HTTP 备选

保留 `start-http.bat`（仅 `npm start`，HTTP 3000），用于排查 HTTPS / 证书 / Windows Defender 问题：HTTP 一启动即可判断是否 HTTPS 层导致。

## 启动模式取舍

保留双进程 `https-server.js → npm start`，**不**重构为单进程直连 Next request handler。理由：与现有项目一致、迁移 Docker 零成本、尽量少改源码。单进程直连性能更好但需改造启动方式，超出本次目标。

## 访问与默认账户

- HTTPS：`https://localhost`（首次访问浏览器提示 `NET::ERR_CERT_AUTHORITY_INVALID`，点"高级→继续访问"）。
- HTTP 备选：`http://localhost:3000`。
- 默认管理员：`admin@localhost` / `123456`，登录后到"设置→用户管理"管理用户。

## README-deploy.md 常见问题（节选）

- `NET::ERR_CERT_AUTHORITY_INVALID`：自签证书正常现象，首次访问 localhost → 高级 → 继续访问。
- 3000 正常但 443 不通：检查 `CERT_DIR`、`certs/cert.pem`、`certs/key.pem` 是否存在、`.env` 是否被加载。
- Ctrl+C 后进程残留：用 `taskkill /F /IM node.exe` 清理（极端情况）。
- 端口被占：3000/443 被占时改 `.env` 的 `PORT` 或 `HTTPS_PORT`。

## 不在本次范围

- 安装 Docker / Docker Compose 部署（环境无 Docker，已选本地源码路径）。
- AI 提供商配置（部署后在网页设置里配）。
- 公网域名 + Let's Encrypt 证书（本地自签即可）。
- 单进程直连 Next handler 重构（保留双进程）。

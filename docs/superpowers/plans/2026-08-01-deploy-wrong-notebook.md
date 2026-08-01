# Windows 本地生产部署 wrong-notebook 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `E:\2026_wrong-notebook-LB-deploy` 部署 wrong-notebook，本地源码构建运行 + 内置 HTTPS，不依赖 Docker。

**Architecture:** 复制当前源码到独立部署目录 → `npm ci` 安装依赖（含新增的 selfsigned）→ Node 脚本生成 `.env` 与自签证书 → `prisma migrate deploy` + admin 存在性检查 + seed → `npm run build` 生产构建 → `start-production.mjs` 统一启动器管理 Next(3000) + HTTPS 代理(443) 双进程，轮询就绪、统一退出。

**Tech Stack:** Next.js 16 (production build)、Prisma 5.22 + SQLite、Node 24、selfsigned（证书）、dotenv（.env 加载，已是运行时依赖）。

## Global Constraints

- 平台：Windows 11 + Git Bash。所有路径用 Windows 形式 `E:\...`，脚本用 `.mjs`（ESM）。
- 源码来源：`E:\2026_wrong-notebook-LB`（当前仓库，含本地改动）。
- 部署目录：`E:\2026_wrong-notebook-LB-deploy`。
- `npm ci` 安装，**不**用 `npm install`；初始化阶段不带 `--omit=dev`（selfsigned 在 devDependencies）。
- `DATABASE_URL="file:./dev.db"`，**不**改为 `file:./prisma/dev.db`（Prisma 相对 schema.prisma 解析为 `prisma/dev.db`）。
- `NEXTAUTH_SECRET` 用 `crypto.randomBytes(32).toString('hex')` 生成，不依赖 openssl。
- 证书用 `selfsigned` 库生成，不手写 X.509，不要 openssl fallback；SAN 含 `DNS:localhost`、`IP:127.0.0.1`、`IP:::1`。
- `.env` 已存在时 `generate-env.mjs` 跳过，不覆盖。
- 启动器轮询 `http://127.0.0.1:3000` 判断 Next 就绪，2xx/3xx/404 视为 ready，**不** sleep 固定时间。
- 启动器监听 `SIGINT`、`SIGTERM`、`exit`、`uncaughtException`、`unhandledRejection`，统一 kill 子进程。
- 保留双进程 `https-server.js → npm start` 模式，不重构单进程直连。
- 不修改 wrong-notebook 业务源码（`src/`）；仅新增部署辅助脚本与配置文件。
- 部署辅助脚本放 `scripts/deploy/`，不污染 `scripts/` 现有业务脚本。
- 默认管理员：`admin@localhost` / `123456`。

---

## File Structure

| 文件 | 责任 | 创建/修改 |
| --- | --- | --- |
| `package.json` | 把 `selfsigned` 加入 devDependencies | 修改（源码仓库） |
| `scripts/deploy/generate-env.mjs` | 生成 `.env`，已存在则跳过 | 新建 |
| `scripts/deploy/generate-cert.mjs` | 用 selfsigned 生成自签证书到 `certs/` | 新建 |
| `scripts/deploy/start-production.mjs` | 统一启动器：dotenv 加载 + spawn npm start + 轮询就绪 + spawn https-server + 统一退出 | 新建 |
| `scripts/deploy/init-db.mjs` | admin 存在性检查 + migrate deploy + 条件 seed | 新建 |
| `start-https.bat` | 调用 `start-production.mjs` | 新建（部署目录） |
| `start-http.bat` | 备选：仅 `npm start`，HTTP 3000 | 新建（部署目录） |
| `README-deploy.md` | 部署/运维说明 + 常见问题 | 新建（部署目录） |
| `docs/superpowers/specs/2026-08-01-deploy-wrong-notebook-design.md` | 设计 spec | 已存在 |

> 注：`package.json` 的修改在**源码仓库** `E:\2026_wrong-notebook-LB` 进行并提交，随后 robocopy 复制时一并带到部署目录。其余 `.mjs`/`.bat`/`README-deploy.md` 既在源码仓库新建（纳入版本管理），复制时带到部署目录。

---

### Task 1: 把 selfsigned 加入 devDependencies

**Files:**
- Modify: `E:\2026_wrong-notebook-LB\package.json`（devDependencies 块）
- Modify: `E:\2026_wrong-notebook-LB\package-lock.json`（由 `npm install` 自动更新）

**Interfaces:**
- Produces: `selfsigned` 作为 devDependency 可被 `import` / `require`，供 Task 3 的 `generate-cert.mjs` 使用。

- [ ] **Step 1: 安装 selfsigned 为 devDependency**

在源码仓库根目录运行（会更新 package.json 与 package-lock.json）：

```bash
cd E:/2026_wrong-notebook-LB && npm install --save-dev selfsigned
```

预期：`package.json` 的 `devDependencies` 新增 `"selfsigned": "^2.x"`（以实际发布版本为准），`package-lock.json` 同步更新。

- [ ] **Step 2: 验证可加载**

```bash
cd E:/2026_wrong-notebook-LB && node -e "const s=require('selfsigned'); console.log(typeof s.generate)"
```

预期：输出 `function`。

- [ ] **Step 3: 提交**

```bash
cd E:/2026_wrong-notebook-LB && git add package.json package-lock.json && git commit -m "build: add selfsigned devDependency for local HTTPS cert generation

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: generate-env.mjs — 生成 .env（已存在则跳过）

**Files:**
- Create: `E:\2026_wrong-notebook-LB\scripts\deploy\generate-env.mjs`

**Interfaces:**
- Consumes: 无（运行于部署目录，读 `process.cwd()`）。
- Produces: 部署目录下的 `.env` 文件，含 `DATABASE_URL`、`NEXTAUTH_SECRET`、`AUTH_TRUST_HOST`、`HTTPS_ENABLED`、`CERT_DIR`、`CERT_DOMAIN`、`LOG_LEVEL`。供 Task 5 的 `start-production.mjs` 通过 `dotenv` 加载。

- [ ] **Step 1: 写脚本**

创建 `scripts/deploy/generate-env.mjs`：

```javascript
// 生成 .env 用于 Windows 本地生产部署。若 .env 已存在则跳过，避免覆盖已填配置。
import { writeFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';

const cwd = process.cwd();
const envPath = resolve(cwd, '.env');

if (existsSync(envPath)) {
    console.log(`[generate-env] .env 已存在，跳过生成：${envPath}`);
    console.log('[generate-env] 如需重新生成，请先备份并删除现有 .env。');
    process.exit(0);
}

const secret = randomBytes(32).toString('hex');
// CERT_DIR 用部署目录下的 certs，正反斜杠均可被 Node fs 识别，这里用 Windows 形式
const certDir = resolve(cwd, 'certs');

const content = [
    `# 数据库连接（Prisma 相对 schema.prisma 解析，file:./dev.db => prisma/dev.db）`,
    `DATABASE_URL="file:./dev.db"`,
    ``,
    `# NextAuth 会话加密密钥（自动生成）`,
    `NEXTAUTH_SECRET="${secret}"`,
    ``,
    `# 信任 Host 请求头（本地/Docker 适用）`,
    `AUTH_TRUST_HOST=true`,
    ``,
    `# HTTPS 配置`,
    `HTTPS_ENABLED=true`,
    `CERT_DIR=${certDir.replace(/\\/g, '\\\\')}`,
    `CERT_DOMAIN=localhost`,
    ``,
    `# 日志级别：trace/debug/info/warn/error/fatal`,
    `LOG_LEVEL=info`,
    ``,
    `# AI 配置留空，部署后在网页"设置"里配置（写入 config/app-config.json，优先级高于 .env）`,
    `AI_PROVIDER="gemini"`,
    `GOOGLE_API_KEY=""`,
    `OPENAI_API_KEY=""`,
    `OPENAI_BASE_URL=""`,
    `OPENAI_MODEL="gpt-4o"`,
    `GEMINI_BASE_URL=""`,
    `GEMINI_MODEL="gemini-2.5-flash"`,
    ``,
].join('\n');

writeFileSync(envPath, content, 'utf8');
console.log(`[generate-env] 已生成：${envPath}`);
console.log(`[generate-env] NEXTAUTH_SECRET 已自动生成随机值。`);
console.log(`[generate-env] CERT_DIR=${certDir}`);
```

- [ ] **Step 2: 验证脚本（在临时目录，避免污染源码仓库）**

```bash
cd "$(mktemp -d)" && cp E:/2026_wrong-notebook-LB/scripts/deploy/generate-env.mjs . && node generate-env.mjs && echo "--- .env 内容 ---" && cat .env
```

预期：生成 `.env`，`DATABASE_URL="file:./dev.db"`，`NEXTAUTH_SECRET` 为 64 位 hex，`CERT_DIR` 指向当前目录的 `certs`。再次运行 `node generate-env.mjs` 应输出"已存在，跳过"。

- [ ] **Step 3: 提交**

```bash
cd E:/2026_wrong-notebook-LB && git add scripts/deploy/generate-env.mjs && git commit -m "feat(deploy): add generate-env.mjs for .env generation

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: generate-cert.mjs — 用 selfsigned 生成自签证书

**Files:**
- Create: `E:\2026_wrong-notebook-LB\scripts\deploy\generate-cert.mjs`

**Interfaces:**
- Consumes: `selfsigned`（Task 1 加入 devDependencies）；`CERT_DIR` 环境变量（可选，默认 `process.cwd()/certs`）。
- Produces: `certs/cert.pem` 与 `certs/key.pem`，SAN 含 `localhost`/`127.0.0.1`/`::1`，有效期 10 年。供 `https-server.js` 读取。

- [ ] **Step 1: 写脚本**

创建 `scripts/deploy/generate-cert.mjs`：

```javascript
// 用 selfsigned 生成自签证书（PEM），含 SAN，供本地 HTTPS 代理使用。
// 不手写 X.509，不依赖 openssl。
import selfsigned from 'selfsigned';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const cwd = process.cwd();
const certDir = process.env.CERT_DIR
    ? process.env.CERT_DIR.replace(/\\\\/g, '\\')
    : resolve(cwd, 'certs');
const certFile = resolve(certDir, 'cert.pem');
const keyFile = resolve(certDir, 'key.pem');

if (existsSync(certFile) && existsSync(keyFile)) {
    console.log(`[generate-cert] 证书已存在，跳过：${certDir}`);
    process.exit(0);
}

mkdirSync(certDir, { recursive: true });

// SAN：覆盖 https://localhost 与 https://127.0.0.1
const attrs = [{ name: 'commonName', value: 'localhost' }];
const opts = {
    keySize: 2048,
    days: 3650, // 10 年
    algorithm: 'sha256',
    extensions: [
        { name: 'keyUsage', keyCertSign: true, digitalSignature: true },
        { name: 'extKeyUsage', serverAuth: true },
        { name: 'subjectAltName', altNames: [
            { type: 2, value: 'localhost' },                 // DNS
            { type: 7, ip: '127.0.0.1' },                     // IP
            { type: 7, ip: '::1' },                            // IPv6
        ] },
    ],
};

const pems = selfsigned.generate(attrs, opts);

writeFileSync(certFile, pems.cert, 'utf8');
writeFileSync(keyFile, pems.private, 'utf8');

console.log(`[generate-cert] 证书已生成：`);
console.log(`  cert: ${certFile}`);
console.log(`  key:  ${keyFile}`);
console.log(`[generate-cert] SAN: localhost, 127.0.0.1, ::1`);
console.log(`[generate-cert] 有效期 10 年。浏览器首次访问会提示不安全，点"高级→继续访问"。`);
```

- [ ] **Step 2: 验证脚本（在临时目录，需能找到 selfsigned）**

由于 `selfsigned` 在源码仓库的 `node_modules`，验证时在源码仓库根目录跑（用临时 CERT_DIR 避免污染）：

```bash
cd E:/2026_wrong-notebook-LB && CERT_DIR="$(mktemp -d)/certs" node scripts/deploy/generate-cert.mjs && echo "--- cert head ---" && head -2 "$(echo $CERT_DIR)/cert.pem" 2>/dev/null || head -2 "$TEMP/certs/cert.pem" 2>/dev/null
```

预期：输出"证书已生成"，`cert.pem` 首行为 `-----BEGIN CERTIFICATE-----`。再次运行应输出"已存在，跳过"。

- [ ] **Step 3: 提交**

```bash
cd E:/2026_wrong-notebook-LB && git add scripts/deploy/generate-cert.mjs && git commit -m "feat(deploy): add generate-cert.mjs using selfsigned

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: init-db.mjs — admin 存在性检查 + migrate deploy + 条件 seed

**Files:**
- Create: `E:\2026_wrong-notebook-LB\scripts\deploy\init-db.mjs`

**Interfaces:**
- Consumes: `DATABASE_URL`（来自 `.env`，由调用方 `node -r dotenv/config` 注入或脚本内 `dotenv/config`）；Prisma 生成的 `@prisma/client`。
- Produces: `prisma/dev.db`（由 migrate deploy 创建）+ admin 用户（仅当不存在时）。

- [ ] **Step 1: 写脚本**

创建 `scripts/deploy/init-db.mjs`：

```javascript
// 数据库初始化：migrate deploy + admin 存在性检查 + 条件 seed。
// 在部署目录运行，需先由 generate-env.mjs 生成 .env。
import { execSync } from 'node:child_process';
import { config } from 'dotenv';

config(); // 加载 .env

const adminEmail = 'admin@localhost';

function run(cmd, label) {
    console.log(`[init-db] ${label}...`);
    execSync(cmd, { stdio: 'inherit' });
}

// 1. 应用迁移（自动创建 dev.db）
run('npx prisma migrate deploy', '应用数据库迁移');

// 2. admin 存在性检查
console.log(`[init-db] 检查管理员 ${adminEmail} 是否存在...`);
let adminExists = false;
try {
    const check = execSync(
        `node -e "const {PrismaClient}=require('@prisma/client');(async()=>{const p=new PrismaClient();const u=await p.user.findUnique({where:{email:'${adminEmail}'}});console.log(u?'EXISTS':'NOT_EXISTS');await p.\\$disconnect();})()"`,
        { encoding: 'utf8' }
    );
    adminExists = check.includes('EXISTS');
} catch (e) {
    console.error('[init-db] admin 检查失败，将执行 seed 以确保管理员存在：', e.message);
}

// 3. 条件 seed
if (adminExists) {
    console.log(`[init-db] 管理员 ${adminEmail} 已存在，跳过 seed（不重置密码）。`);
} else {
    console.log(`[init-db] 管理员不存在，执行 seed...`);
    run('npx prisma db seed', '创建管理员与种子数据');
    console.log(`[init-db] 管理员已创建：${adminEmail} / 123456`);
}

console.log('[init-db] 数据库初始化完成。');
```

- [ ] **Step 2: 验证脚本逻辑（dry check，不实际建库）**

仅做语法与 import 检查（实际建库在 Task 8 部署时执行）：

```bash
cd E:/2026_wrong-notebook-LB && node --check scripts/deploy/init-db.mjs && echo "语法 OK"
```

预期：输出"语法 OK"。

- [ ] **Step 3: 提交**

```bash
cd E:/2026_wrong-notebook-LB && git add scripts/deploy/init-db.mjs && git commit -m "feat(deploy): add init-db.mjs for migrate + idempotent admin seed

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: start-production.mjs — 统一启动器

**Files:**
- Create: `E:\2026_wrong-notebook-LB\scripts\deploy\start-production.mjs`

**Interfaces:**
- Consumes: `.env`（dotenv 加载，子进程继承 env）；`https-server.js`（项目根，443 代理）；`npm start`（Next，3000）。
- Produces: 运行中的 Next(3000) + HTTPS 代理(443)，统一生命周期管理。

- [ ] **Step 1: 写脚本**

创建 `scripts/deploy/start-production.mjs`：

```javascript
// 统一启动器：dotenv 加载 -> spawn npm start(Next,3000) -> 轮询就绪 -> spawn https-server.js(443) -> 统一退出。
import { spawn } from 'node:child_process';
import { config } from 'dotenv';
import { request } from 'node:http';

config(); // 加载 .env，子进程继承 process.env

const NEXT_PORT = parseInt(process.env.PORT || '3000', 10);
const nextUrl = `http://127.0.0.1:${NEXT_PORT}`;

let nextProc = null;
let httpsProc = null;
let shuttingDown = false;

function killProc(proc, name) {
    if (!proc || proc.exitCode !== null) return;
    try {
        console.log(`[start] 终止 ${name} (pid=${proc.pid})`);
        proc.kill('SIGTERM');
    } catch (e) { /* 忽略 */ }
}

function shutdown(code = 0) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log('\n[start] 正在关闭所有子进程...');
    killProc(httpsProc, 'https-server');
    killProc(nextProc, 'npm start');
    // Windows 下 SIGTERM 可能不够，给一点时间后强制
    setTimeout(() => process.exit(code), 500);
}

// 任何退出路径都清理子进程
['SIGINT', 'SIGTERM', 'exit', 'uncaughtException', 'unhandledRejection'].forEach((evt) => {
    process.on(evt, (err) => {
        if (err && (evt === 'uncaughtException' || evt === 'unhandledRejection')) {
            console.error(`[start] ${evt}:`, err);
        }
        shutdown(evt === 'exit' ? undefined : 1);
    });
});

// 轮询 Next 就绪：2xx/3xx/404 都算 ready
function checkReady() {
    return new Promise((resolve) => {
        const req = request(nextUrl, { method: 'GET', timeout: 2000 }, (res) => {
            res.resume();
            resolve(res.statusCode < 500); // 2xx/3xx/404 => true; 5xx => false
        });
        req.on('error', () => resolve(false));
        req.on('timeout', () => { req.destroy(); resolve(false); });
        req.end();
    });
}

async function waitForNext(maxAttempts = 60, intervalMs = 1000) {
    for (let i = 1; i <= maxAttempts; i++) {
        if (await checkReady()) {
            console.log(`[start] Next 已就绪 (${nextUrl})，第 ${i} 次轮询命中。`);
            return true;
        }
        await new Promise((r) => setTimeout(r, intervalMs));
    }
    return false;
}

async function main() {
    // 1. 启动 Next 生产服务器
    console.log(`[start] 启动 Next 生产服务器 (npm start, 端口 ${NEXT_PORT})...`);
    nextProc = spawn('npm', ['start'], { stdio: 'inherit', shell: true, env: process.env });
    nextProc.on('exit', (code, signal) => {
        console.log(`[start] npm start 退出 code=${code} signal=${signal}`);
        if (!shuttingDown) {
            console.error('[start] Next 意外退出，关闭 HTTPS 代理并退出。');
            shutdown(1);
        }
    });

    // 2. 轮询就绪
    const ready = await waitForNext();
    if (!ready) {
        console.error(`[start] Next 在 60 秒内未就绪 (${nextUrl})，退出。`);
        shutdown(1);
        return;
    }

    // 3. 启动 HTTPS 代理
    console.log('[start] 启动 HTTPS 代理 (https-server.js, 端口 443)...');
    httpsProc = spawn('node', ['https-server.js'], { stdio: 'inherit', shell: true, env: process.env });
    httpsProc.on('exit', (code, signal) => {
        console.log(`[start] https-server 退出 code=${code} signal=${signal}`);
        if (!shuttingDown) {
            console.error('[start] HTTPS 代理意外退出。');
            shutdown(1);
        }
    });

    console.log(`[start] 全部就绪：HTTPS https://localhost -> Next ${nextUrl}`);
    console.log('[start] 按 Ctrl+C 关闭所有服务。');
}

main();
```

- [ ] **Step 2: 验证语法**

```bash
cd E:/2026_wrong-notebook-LB && node --check scripts/deploy/start-production.mjs && echo "语法 OK"
```

预期：输出"语法 OK"。

- [ ] **Step 3: 提交**

```bash
cd E:/2026_wrong-notebook-LB && git add scripts/deploy/start-production.mjs && git commit -m "feat(deploy): add start-production.mjs unified launcher

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 6: start-https.bat 与 start-http.bat

**Files:**
- Create: `E:\2026_wrong-notebook-LB\start-https.bat`
- Create: `E:\2026_wrong-notebook-LB\start-http.bat`

**Interfaces:**
- Consumes: `scripts/deploy/start-production.mjs`（Task 5）；`npm start`。
- Produces: 双击即启动的入口。

- [ ] **Step 1: 写 start-https.bat**

创建 `start-https.bat`：

```bat
@echo off
REM wrong-notebook HTTPS 启动入口（Next 3000 + HTTPS 代理 443）
cd /d "%~dp0"
node scripts\deploy\start-production.mjs
pause
```

- [ ] **Step 2: 写 start-http.bat**

创建 `start-http.bat`（备选，仅 HTTP，用于排查 HTTPS 问题）：

```bat
@echo off
REM wrong-notebook HTTP 启动入口（仅 Next 3000，无 HTTPS）
cd /d "%~dp0"
npm start
pause
```

- [ ] **Step 3: 提交**

```bash
cd E:/2026_wrong-notebook-LB && git add start-https.bat start-http.bat && git commit -m "feat(deploy): add start-https.bat and start-http.bat entry points

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 7: README-deploy.md

**Files:**
- Create: `E:\2026_wrong-notebook-LB\README-deploy.md`

**Interfaces:**
- 无（纯文档）。

- [ ] **Step 1: 写文档**

创建 `README-deploy.md`：

````markdown
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
````

- [ ] **Step 2: 提交**

```bash
cd E:/2026_wrong-notebook-LB && git add README-deploy.md && git commit -m "docs: add README-deploy.md for Windows local deployment

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 8: 执行部署（复制 + 初始化 + 构建 + 启动验证）

**Files:**
- 无新建文件；在部署目录执行已写好的脚本与命令。

**Interfaces:**
- Consumes: Task 1–7 全部产物。

- [ ] **Step 1: robocopy 复制源码到部署目录**

```bash
robocopy E:\\2026_wrong-notebook-LB E:\\2026_wrong-notebook-LB-deploy /E /XD node_modules .git .next data .next-prebuilt dist-scripts certs /XF *.log
```

预期：复制完成。robocopy 退出码 < 8 视为成功（0=无变化，1=正常复制）。

- [ ] **Step 2: npm ci**

```bash
cd /e/2026_wrong-notebook-LB-deploy && npm ci
```

预期：依赖安装完成，better-sqlite3 原生绑定构建成功。

- [ ] **Step 3: 生成 .env**

```bash
node scripts/deploy/generate-env.mjs
```

预期：输出"已生成"，`NEXTAUTH_SECRET` 为随机值。

- [ ] **Step 4: 生成证书**

```bash
node scripts/deploy/generate-cert.mjs
```

预期：`certs/cert.pem` 与 `certs/key.pem` 生成。

- [ ] **Step 5: 初始化数据库**

```bash
node scripts/deploy/init-db.mjs
```

预期：migrate deploy 应用 10 个迁移，创建 `prisma/dev.db`，admin 不存在则 seed 创建。

- [ ] **Step 6: 生产构建**

```bash
npm run build
```

预期：Next 构建成功，产出 `.next/`。

- [ ] **Step 7: 启动验证（HTTP 先行）**

```bash
npm start &
sleep 8 && curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3000
```

预期：返回 2xx/3xx（通常 200 或 307）。验证后 `kill %1` 停止。

- [ ] **Step 8: 启动验证（HTTPS）**

```bash
node scripts/deploy/start-production.mjs &
sleep 12 && curl -sk -o /dev/null -w "%{http_code}" https://127.0.0.1/
```

预期：返回 2xx/3xx（`-k` 忽略自签证书校验）。验证后 `kill %1`，确认两个子进程都被清理。

- [ ] **Step 9: 记录部署结果**

在源码仓库提交一个部署完成标记（可选）：

```bash
cd E:/2026_wrong-notebook-LB && git log --oneline -1
```

---

## Self-Review

**1. Spec coverage:**
- 目录结构 → Task 1–7 文件结构表 + Task 8 Step 1 robocopy。✅
- 一次性初始化流程 7 步 → Task 8 Step 1–6。✅
- `.env` 内容 + DATABASE_URL 说明 → Task 2 脚本 + Global Constraints。✅
- 证书生成（selfsigned + SAN）→ Task 3。✅
- 日常启动 + 轮询就绪 + 统一退出 → Task 5。✅
- HTTP 备选 → Task 6 start-http.bat。✅
- README 常见问题 → Task 7。✅
- admin 幂等 seed → Task 4。✅
- 不改业务源码 → 全部新增脚本在 `scripts/deploy/` + `package.json` 仅加 devDep。✅

**2. Placeholder scan:** 无 TBD/TODO；每步含实际命令或代码。✅

**3. Type consistency:** `generate-env.mjs` 写 `CERT_DIR`，`generate-cert.mjs` 读 `process.env.CERT_DIR`，`start-production.mjs` 用 `dotenv` 加载后子进程继承 env（含 `CERT_DIR`，供 `https-server.js` 读取）——链路一致。`NEXT_PORT` 默认 3000 与 `https-server.js` 的 `PORT` 默认 3000 一致。✅

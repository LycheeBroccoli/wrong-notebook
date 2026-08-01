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
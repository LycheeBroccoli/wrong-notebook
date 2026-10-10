// E2E：登录 3000 -> 调内置 AI 测试接口，验证 gpt-5.4-mini 修复后 success:true
import { readFileSync } from 'node:fs';

const BASE = 'http://127.0.0.1:3000';
const cfg = JSON.parse(readFileSync('E:\\2026_wrong-notebook-LB-deploy\\config\\app-config.json', 'utf8'));
const inst = cfg.openai.instances.find(i => i.id === cfg.openai.activeInstanceId);
const { apiKey, baseUrl, model } = inst;

async function main() {
    // 1. 拿 CSRF token
    const csrfRes = await fetch(`${BASE}/api/auth/csrf`);
    const { csrfToken } = await csrfRes.json();
    const cookies = csrfRes.headers.get('set-cookie') || '';
    const setCookie = (h) => (h || '').split(',').map(c => c.split(';')[0]).join('; ');
    let jar = setCookie(cookies);

    // 2. 登录
    const loginRes = await fetch(`${BASE}/api/auth/callback/credentials`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Cookie: jar,
        },
        body: new URLSearchParams({
            csrfToken,
            email: 'admin@localhost',
            password: '123456',
            json: 'true',
        }),
        redirect: 'manual',
    });
    jar = setCookie(loginRes.headers.get('set-cookie')) || jar;
    const hasSession = jar.includes('next-auth.session-token') || jar.includes('session-token');
    console.log(`[login] ${loginRes.status} session=${hasSession}`);
    if (!hasSession) {
        console.log('登录失败，admin 密码可能不是 123456');
        return;
    }

    // 3. 调内置 AI 测试
    const t0 = Date.now();
    const testRes = await fetch(`${BASE}/api/ai/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: jar },
        body: JSON.stringify({ provider: 'openai', apiKey, baseUrl, model, language: 'zh' }),
    });
    const dt = Date.now() - t0;
    const body = await testRes.json();
    console.log(`[ai/test] ${testRes.status} ${dt}ms`);
    console.log(JSON.stringify(body, null, 2));
}

main().catch(e => { console.error('EXCEPTION:', e.message); process.exit(1); });

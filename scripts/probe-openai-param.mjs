// 最小实验：验证 gpt-5.4-mini 对 max_tokens / max_completion_tokens 的接受情况
// 走公司代理（Node fetch 默认不读系统代理/PAC，必须显式装 undici 代理）
import { setGlobalDispatcher, ProxyAgent } from 'undici';

const PROXY = 'http://proxy.hikvision.com.cn:8080';
setGlobalDispatcher(new ProxyAgent(PROXY));

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) throw new Error('Set OPENAI_API_KEY in your own environment before running this optional probe.');
const baseURL = 'https://api.openai.com/v1';
const model = 'gpt-5.4-mini';

async function call(label, extra) {
    const t0 = Date.now();
    try {
        const res = await fetch(`${baseURL}/chat/completions`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model,
                messages: [
                    { role: 'system', content: '你是助手。' },
                    { role: 'user', content: '1+1=? 只回答数字。' },
                ],
                ...extra,
            }),
        });
        const body = await res.json();
        const dt = Date.now() - t0;
        if (res.ok) {
            const text = body?.choices?.[0]?.message?.content ?? '(空)';
            console.log(`[${label}] OK ${dt}ms -> ${JSON.stringify(text).slice(0, 80)}`);
        } else {
            const msg = body?.error?.message ?? JSON.stringify(body).slice(0, 200);
            console.log(`[${label}] ${res.status} ${dt}ms -> ${msg}`);
        }
    } catch (e) {
        console.log(`[${label}] EXCEPTION ${Date.now() - t0}ms -> ${e.message}`);
    }
}

console.log(`模型: ${model}  代理: ${PROXY}\n`);
await call('max_tokens=8192 (旧)', { max_tokens: 8192 });
await call('max_completion_tokens=8192 (新)', { max_completion_tokens: 8192 });
await call('不带 max_* 参数', {});

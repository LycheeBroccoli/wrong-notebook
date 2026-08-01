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
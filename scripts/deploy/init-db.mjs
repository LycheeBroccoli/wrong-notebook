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

// admin 存在性检查助手：查询 admin@localhost 是否已存在，打印 EXISTS 或 NOT_EXISTS。
// 由 init-db.mjs 通过 spawn 调用，避免内联 node -e 的 shell 转义问题。
// 自身加载 .env，保证独立运行也能拿到 DATABASE_URL。
import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';

config();

const prisma = new PrismaClient();

async function main() {
    const adminEmail = 'admin@localhost';
    const user = await prisma.user.findUnique({ where: { email: adminEmail } });
    console.log(user ? 'EXISTS' : 'NOT_EXISTS');
}

main()
    .catch((e) => {
        console.error('[check-admin] 查询失败：', e.message);
        process.exit(2);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });

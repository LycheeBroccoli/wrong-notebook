import dotenv from "dotenv";
import path from "path";
import { prisma } from "../src/lib/prisma";

dotenv.config({ path: path.resolve(__dirname, "../.env") });

async function main() {
  const total = await prisma.knowledgeTag.count({ where: { subject: "math" } });
  console.log("math tags total:", total);

  const sysCount = await prisma.knowledgeTag.count({ where: { subject: "math", isSystem: true } });
  console.log("math isSystem=true:", sysCount);

  const top = await prisma.knowledgeTag.findMany({
    where: { subject: "math", parentId: null },
    select: { id: true, name: true, isSystem: true },
    take: 30,
  });
  console.log(`top-level (parentId=null) math tags (${top.length}):`);
  top.forEach((t) => console.log(`  - "${t.name}"  isSystem=${t.isSystem}`));

  // 直接查 name 是否含"八年级"
  const g8 = await prisma.knowledgeTag.findMany({
    where: { subject: "math", name: { contains: "八年级" } },
    select: { name: true, parentId: true, isSystem: true },
    take: 10,
  });
  console.log(`name contains "八年级" (${g8.length}):`);
  g8.forEach((t) => console.log(`  - "${t.name}"  parentId=${t.parentId} isSystem=${t.isSystem}`));

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });

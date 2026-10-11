import dotenv from "dotenv";
import path from "path";
import { prisma } from "../src/lib/prisma";

dotenv.config({ path: path.resolve(__dirname, "../.env") });

async function main() {
  const id = process.argv[2];
  if (!id) { console.error("usage: inspect-error-item.ts <errorItemId>"); process.exit(1); }

  const item = await prisma.errorItem.findUnique({
    where: { id },
    include: {
      subject: { select: { name: true } },
      user: { select: { email: true, educationStage: true, enrollmentYear: true } },
      tags: { select: { name: true, subject: true, isSystem: true } },
    },
  });

  if (!item) { console.error("ErrorItem not found:", id); process.exit(1); }

  console.log("===== ErrorItem 元数据 =====");
  console.log("id              :", item.id);
  console.log("createdAt       :", item.createdAt.toISOString());
  console.log("userId          :", item.userId);
  console.log("user.email      :", item.user.email);
  console.log("user.educationStage:", item.user.educationStage);
  console.log("user.enrollmentYear:", item.user.enrollmentYear);
  console.log("subjectId       :", item.subjectId);
  console.log("subject.name    :", item.subject?.name ?? "(null)");
  console.log("gradeSemester   :", item.gradeSemester ?? "(null)");
  console.log("originalImageUrl:", item.originalImageUrl);
  console.log("tags (", item.tags.length, "):");
  item.tags.forEach((t) => console.log(`  - [${t.subject}] "${t.name}" isSystem=${t.isSystem}`));

  console.log("\n===== AI 已存的结构化结果 =====");
  console.log("questionText    :", (item.questionText || "").slice(0, 120) + (item.questionText && item.questionText.length > 120 ? "…" : ""));
  console.log("answerText      :", (item.answerText || "").slice(0, 120) + (item.answerText && item.answerText.length > 120 ? "…" : ""));
  console.log("analysis        :", (item.analysis || "").slice(0, 120) + (item.analysis && item.analysis.length > 120 ? "…" : ""));
  console.log("wrongAnswerText :", (item.wrongAnswerText || "").slice(0, 120));
  console.log("mistakeAnalysis :", (item.mistakeAnalysis || "").slice(0, 120));
  console.log("mistakeStatus   :", item.mistakeStatus);

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });

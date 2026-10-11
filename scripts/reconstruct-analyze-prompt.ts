/**
 * 重建某道错题"当初录入图片时发给 AI 的 prompt"。
 *
 * 复现链路（与 src/app/api/analyze/route.ts + gemini-provider.ts:166-190 一致）：
 *   1. 从 ErrorItem 读 userId / subjectId
 *   2. 从 User 读 educationStage / enrollmentYear
 *   3. calculateGradeNumber + calculateGrade 算出 grade / gradeSemester
 *   4. 从 Subject.name 推断学科中文名
 *   5. provider 取各科标签（subject='数学' 时只取数学标签）
 *   6. generateAnalyzePrompt 填充
 *
 * 停在 API 调用之前——不联网、不要 key。
 *
 * 用法： npx ts-node --project scripts/tsconfig.scripts.json --require tsconfig-paths/register \
 *        scripts/reconstruct-analyze-prompt.ts <errorItemId>
 */
import dotenv from "dotenv";
import path from "path";
import { prisma } from "../src/lib/prisma";
import { calculateGradeNumber, inferSubjectFromName } from "../src/lib/knowledge-tags";
import { calculateGrade } from "../src/lib/grade-calculator";
import { generateAnalyzePrompt } from "../src/lib/ai/prompts";
import { getMathTagsFromDB, getTagsFromDB } from "../src/lib/ai/tag-service";
import { getAppConfig } from "../src/lib/config";

dotenv.config({ path: path.resolve(__dirname, "../.env") });

const subjectNameMapping: Record<string, string> = {
  math: "数学", physics: "物理", chemistry: "化学", biology: "生物",
  english: "英语", chinese: "语文", history: "历史", geography: "地理", politics: "政治",
};

async function main() {
  const id = process.argv[2];
  if (!id) { console.error("用法: reconstruct-analyze-prompt.ts <errorItemId>"); process.exit(1); }

  const item = await prisma.errorItem.findUnique({
    where: { id },
    include: {
      subject: { select: { name: true } },
      user: { select: { email: true, educationStage: true, enrollmentYear: true } },
    },
  });
  if (!item) { console.error("ErrorItem 不存在:", id); process.exit(1); }

  // ---- 复现 analyze/route.ts 的年级/学科计算 ----
  const userGrade = calculateGradeNumber(item.user.educationStage, item.user.enrollmentYear);
  const userGradeSemester = (item.user.educationStage && item.user.enrollmentYear)
    ? calculateGrade(item.user.educationStage, item.user.enrollmentYear, new Date(), "zh")
    : null;
  const subjectKey = inferSubjectFromName(item.subject?.name ?? null);
  const subjectChinese = subjectKey ? subjectNameMapping[subjectKey] : null;

  console.log("===== 重建参数（来自这道错题的真实元数据）=====");
  console.log("errorItemId        :", item.id);
  console.log("createdAt          :", item.createdAt.toISOString());
  console.log("user.email         :", item.user.email);
  console.log("educationStage     :", item.user.educationStage);
  console.log("enrollmentYear     :", item.user.enrollmentYear);
  console.log("→ calculateGradeNumber :", userGrade);
  console.log("→ calculateGrade(gradeSemester):", userGradeSemester);
  console.log("subject.name       :", item.subject?.name);
  console.log("→ inferSubjectFromName  :", subjectKey);
  console.log("→ subjectChinese        :", subjectChinese);
  console.log("DB 里存的 gradeSemester :", item.gradeSemester, "(对比: 与计算值",
    item.gradeSemester === userGradeSemester ? "一致" : "不一致", ")");

  // ---- 复现 provider.analyzeImage 的标签获取 ----
  const subject = subjectChinese;
  const prefetchedMathTags = (subject === "数学" || !subject) ? await getMathTagsFromDB(userGrade) : [];
  const prefetchedPhysicsTags = (subject === "物理" || !subject) ? await getTagsFromDB("physics") : [];
  const prefetchedChemistryTags = (subject === "化学" || !subject) ? await getTagsFromDB("chemistry") : [];
  const prefetchedBiologyTags = (subject === "生物" || !subject) ? await getTagsFromDB("biology") : [];
  const prefetchedEnglishTags = (subject === "英语" || !subject) ? await getTagsFromDB("english") : [];

  console.log("\n===== 从 DB 取到的标签 =====");
  console.log("math tags:", prefetchedMathTags.length, prefetchedMathTags.slice(0, 8));
  console.log("physics  :", prefetchedPhysicsTags.length);
  console.log("chemistry:", prefetchedChemistryTags.length);
  console.log("biology  :", prefetchedBiologyTags.length);
  console.log("english  :", prefetchedEnglishTags.length);

  // ---- 复现 generateAnalyzePrompt ----
  const prompt = generateAnalyzePrompt("zh", userGrade, subject, {
    customTemplate: getAppConfig().prompts?.analyze,
    prefetchedMathTags,
    prefetchedPhysicsTags,
    prefetchedChemistryTags,
    prefetchedBiologyTags,
    prefetchedEnglishTags,
  }, userGradeSemester);

  console.log("\n===== 📝 重建出的完整 prompt（当初发给 AI 的同一套字符串）=====");
  console.log(prompt);
  console.log("\n===== END =====");
  console.log("prompt 长度:", prompt.length, "字符");
  console.log("customTemplate:", getAppConfig().prompts?.analyze ? "(来自 config/app-config.json)" : "(无，用默认模板)");

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });

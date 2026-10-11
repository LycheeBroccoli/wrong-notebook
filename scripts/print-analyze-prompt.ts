/**
 * 打印"数学错题解析"实际发给 AI 的完整 prompt（已填充变量）。
 *
 * 复现 gemini-provider.ts:166-190 的逻辑，但停在 API 调用之前——
 * 不需要 API key、不联网，只把 generateAnalyzePrompt 填好后的字符串打印出来。
 *
 * 用法：  npx ts-node scripts/print-analyze-prompt.ts
 *
 * 参数（可选，环境变量覆盖默认值）：
 *   GRADE=8          年级 7-12（7=初一 … 12=高三）
 *   GRADE_SEMESTER=初二上  传给 generateGradeInstruction 的中文年级学期
 *   LANGUAGE=zh      zh | en
 */
import dotenv from "dotenv";
import path from "path";
import { generateAnalyzePrompt } from "../src/lib/ai/prompts";
import { getMathTagsFromDB, getTagsFromDB } from "../src/lib/ai/tag-service";
import { getAppConfig } from "../src/lib/config";

dotenv.config({ path: path.resolve(__dirname, "../.env") });

async function main() {
  const grade = (Number(process.env.GRADE) || 8) as 7 | 8 | 9 | 10 | 11 | 12;
  const gradeSemester = process.env.GRADE_SEMESTER || "初二上";
  const language = (process.env.LANGUAGE === "en" ? "en" : "zh") as "zh" | "en";
  const subject = "数学";

  console.log("\n========== 参数 ==========");
  console.log(`provider     : ${getAppConfig().aiProvider}`);
  console.log(`subject      : ${subject}`);
  console.log(`grade        : ${grade}`);
  console.log(`gradeSemester: ${gradeSemester}`);
  console.log(`language     : ${language}`);
  console.log(`customTemplate: ${getAppConfig().prompts?.analyze ? "(来自 config/app-config.json，覆盖默认模板)" : "(无，用 DEFAULT_ANALYZE_TEMPLATE)"}`);

  // 与 provider.analyzeImage 完全一致的标签获取
  const prefetchedMathTags = await getMathTagsFromDB(grade);
  const prefetchedPhysicsTags: string[] = [];   // subject='数学' 时 provider 不取其他科标签
  const prefetchedChemistryTags: string[] = [];
  const prefetchedBiologyTags: string[] = [];
  const prefetchedEnglishTags: string[] = [];

  console.log(`\n从 DB 取到的数学标签数: ${prefetchedMathTags.length}`);
  console.log(`前 10 个: ${prefetchedMathTags.slice(0, 10).join(", ")}`);

  const prompt = generateAnalyzePrompt(language, grade, subject, {
    customTemplate: getAppConfig().prompts?.analyze,
    prefetchedMathTags,
    prefetchedPhysicsTags,
    prefetchedChemistryTags,
    prefetchedBiologyTags,
    prefetchedEnglishTags,
  }, gradeSemester);

  console.log("\n========== 📝 Full Prompt（实际发给 AI 的内容）==========");
  console.log(prompt);
  console.log("\n========== END ==========");
  console.log(`prompt 长度: ${prompt.length} 字符`);
}

main().catch((e) => {
  console.error("Failed:", e);
  process.exit(1);
});

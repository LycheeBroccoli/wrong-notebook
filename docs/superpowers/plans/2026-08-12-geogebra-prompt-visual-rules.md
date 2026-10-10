# GeoGebra prompt 视觉呈现规则补充 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `DEFAULT_GEOGEBRA_PROMPT` 中补充三条视觉呈现规则（顶点方位匹配原图、Text 提示词放视图边缘、关键点深色+放大）及对应自检条目，让 AI 生成的 GeoGebra 命令不仅「画对几何关系」，还要「画得像原图、看得清」。

**Architecture:** 纯改 `src/lib/ai/prompts.ts` 的 `DEFAULT_GEOGEBRA_PROMPT` 字符串常量——在三处现有条目说明末尾追加规则文本，并在末尾「关键约束 CRITICAL RULES」清单续编 #16/#17/#18 三条。不改 service 层（`geogebra-commands.ts` 的 `normalizeGeogebraCommands`）、不改前端（`geogebra-demo.tsx`）、不改现有 normalizer 测试。新增一个 prompt 文本级回归测试，断言三条新规则的关键句存在于 prompt 文本中。

**Tech Stack:** Next.js 16 + TypeScript + Vitest（`vitest run`）。Prompt 是模板字符串常量，测试用字符串 `toContain` 断言。

## Global Constraints

- **只改一个文件** `src/lib/ai/prompts.ts` 的 `DEFAULT_GEOGEBRA_PROMPT`（512-694 行）；新增一个测试文件 `src/__tests__/unit/ai/geogebra-prompt-visual-rules.test.ts`。
- **不改动** `src/lib/ai/geogebra-commands.ts`、`src/components/geogebra-demo.tsx`、`src/__tests__/unit/ai/geogebra-commands.test.ts`。
- **不加任何分类标注**（不加 `【几何约束】`/`【视觉呈现】` 标记）——用户明确要求减少 prompt 篇幅。
- **不动现有 prompt 结构**——三处规则追加到现有条目说明末尾，#16/#17/#18 续编到「关键约束」清单末尾，不新增小节。
- Python 命令用 `python`（非 `python3`）；本计划不涉及 Python。
- 项目非 git 仓库，commit 步骤改为「保存文件 + 跑测试验证」。

---

## File Structure

| 文件 | 责任 | 本次动作 |
|---|---|---|
| `src/lib/ai/prompts.ts` | `DEFAULT_GEOGEBRA_PROMPT` 常量（GeoGebra AI 提示词模板）+ `generateGeogebraPrompt` 占位符替换 | **修改**：三处条目说明末尾追加规则文本 + 末尾续编 #16/#17/#18 |
| `src/__tests__/unit/ai/geogebra-prompt-visual-rules.test.ts` | prompt 文本级回归测试，防三条新规则被误删 | **新建** |

---

## Task 1: 补充规则 1——顶点方位匹配原图（问题 1）

**Files:**
- Modify: `src/lib/ai/prompts.ts:555`（正多边形条目 `Polygon(A, B, n)` 说明末尾追加规则文本）
- Modify: `src/lib/ai/prompts.ts:694`（「关键约束」清单末尾续编 #16）
- Test: `src/__tests__/unit/ai/geogebra-prompt-visual-rules.test.ts`（新建，本任务写规则 1 的断言）

**Interfaces:**
- Consumes: 无（首个任务）
- Produces: `DEFAULT_GEOGEBRA_PROMPT` 字符串中包含顶点方位规则文本与 #16 自检条目；后续 Task 2/3 在同一字符串上继续追加。

- [ ] **Step 1: 写失败测试（规则 1 关键句存在性）**

新建文件 `src/__tests__/unit/ai/geogebra-prompt-visual-rules.test.ts`：

```typescript
/**
 * GeoGebra prompt 视觉呈现规则回归测试
 * 防止三条视觉规则被误删（顶点方位/Text 边缘/关键点深色放大）
 */
import { describe, it, expect } from 'vitest';
import { DEFAULT_GEOGEBRA_PROMPT } from '@/lib/ai/prompts';

describe('DEFAULT_GEOGEBRA_PROMPT 视觉呈现规则', () => {
    describe('规则 1：顶点方位匹配原图', () => {
        it('应包含逆时针方向规则说明', () => {
            expect(DEFAULT_GEOGEBRA_PROMPT).toContain('逆时针');
        });

        it('应说明第三顶点落在 A→B 左侧', () => {
            expect(DEFAULT_GEOGEBRA_PROMPT).toContain('从 A 走向 B 时的左侧');
        });

        it('应要求先判断原图顶点方位再选基准边', () => {
            expect(DEFAULT_GEOGEBRA_PROMPT).toContain('先判断原图里每个顶点的相对方位');
        });

        it('应包含 #16 关键约束自检条目', () => {
            expect(DEFAULT_GEOGEBRA_PROMPT).toContain('16. **顶点方位与原图一致**');
            expect(DEFAULT_GEOGEBRA_PROMPT).toContain('派生顶点落点是否与原图一致');
        });
    });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd E:/2026_wrong-notebook-LB-deploy && npx vitest run src/__tests__/unit/ai/geogebra-prompt-visual-rules.test.ts`
Expected: 4 个 FAIL（prompt 当前不含这些关键句）。

- [ ] **Step 3: 在正多边形条目末尾追加规则文本**

在 `src/lib/ai/prompts.ts:555`（`Polygon(A, B, n)` 条目）的说明末尾追加。该行以「注意：Polygon(A,B,3) 的第三顶点由 GeoGebra 自动命名（C），不要另行定义 C = ...。」结尾。

用 Edit 工具，`old_string` 取该行末尾片段，`new_string` 在其后追加规则文本：

old_string（唯一）:
```
注意：Polygon(A,B,3) 的第三顶点由 GeoGebra 自动命名（C），不要另行定义 C = ...。
```

new_string:
```
注意：Polygon(A,B,3) 的第三顶点由 GeoGebra 自动命名（C），不要另行定义 C = ...。用 Polygon(A, B, n) 前，先判断原图里每个顶点的相对方位（谁在顶/左/右/底），据此选哪条边作基准边、A 与 B 谁在左谁在右。方向规则：Polygon(A, B, n) 按逆时针派生，第三顶点（及后续顶点）落在「从 A 走向 B 时的左侧」。例：原图 A 是顶点、B 在左下、C 在右下，应选 BC 为基准边且 B 在左、C 在右（B→C 向右，左侧是上方），第三顶点派生到上方，与原图 A 的位置一致。严禁随意挑两个点作基准边而不核对派生顶点落点是否与原图一致。派生顶点的点名由 GeoGebra 自动分配，若自动点名与原图不符，用 setCaption("自动名", "原图名") 重命名标签文本（此为 setCaption 的正当用途，与「变换点用撇号命名不用 setCaption 绕路」不冲突——后者针对反射/位似/旋转的撇号变换点）。
```

- [ ] **Step 4: 在「关键约束」清单末尾续编 #16**

`src/lib/ai/prompts.ts:694` 是 prompt 模板字符串的最后一段（第 15 条规则，以「见第 5 步 origin 判定。」结尾，其后紧跟反引号 `` ` `` 结束模板）。在该反引号之前、第 15 条之后追加 #16。

old_string（第 15 条结尾 + 模板结束反引号，唯一）:
```
是否构造取决于题目是"作"（constructed）还是"是"（given），见第 5 步 origin 判定。`;
```

new_string:
```
是否构造取决于题目是"作"（constructed）还是"是"（given），见第 5 步 origin 判定。
16. **顶点方位与原图一致**：用 Polygon(A, B, n) 构造正多边形前，必须先判断原图各顶点方位，选对基准边与 A/B 顺序，使派生顶点落到原图对应位置。吐 commands 前自检：派生顶点落点是否与原图一致？`;
```

- [ ] **Step 5: 跑测试确认规则 1 通过**

Run: `cd E:/2026_wrong-notebook-LB-deploy && npx vitest run src/__tests__/unit/ai/geogebra-prompt-visual-rules.test.ts`
Expected: 规则 1 的 4 个测试 PASS。

- [ ] **Step 6: 跑全量 unit 测试确认无回归**

Run: `cd E:/2026_wrong-notebook-LB-deploy && npx vitest run src/__tests__/unit`
Expected: 全绿（含现有 `ai-prompts.test.ts`、`geogebra-commands.test.ts`、`geogebra.test.ts`）。

---

## Task 2: 补充规则 2——Text 提示词放视图边缘（问题 2）

**Files:**
- Modify: `src/lib/ai/prompts.ts:567`（文本条目 `Text("说明文字", (x, y))` 说明末尾追加规则文本）
- Modify: `src/lib/ai/prompts.ts`（「关键约束」清单末尾，#16 之后续编 #17）
- Test: `src/__tests__/unit/ai/geogebra-prompt-visual-rules.test.ts`（追加规则 2 的断言）

**Interfaces:**
- Consumes: Task 1 产出的 prompt 文本（含 #16）
- Produces: prompt 含 Text 边缘规则文本与 #17 自检条目

- [ ] **Step 1: 追加失败测试（规则 2 关键句）**

在 `src/__tests__/unit/ai/geogebra-prompt-visual-rules.test.ts` 的 `describe('DEFAULT_GEOGEBRA_PROMPT 视觉呈现规则', ...)` 内、规则 1 的 describe 块之后追加：

```typescript
    describe('规则 2：Text 提示词放视图边缘', () => {
        it('应要求 Text 坐标放在视图边缘边距区', () => {
            expect(DEFAULT_GEOGEBRA_PROMPT).toContain('边距区');
        });

        it('应说明 Text 与 Slider 定位机制差异', () => {
            expect(DEFAULT_GEOGEBRA_PROMPT).toContain('Slider');
            expect(DEFAULT_GEOGEBRA_PROMPT).toContain('不随数学坐标');
        });

        it('应禁止 Text 压在图形主体上', () => {
            expect(DEFAULT_GEOGEBRA_PROMPT).toContain('不得压在图形主体上');
        });

        it('应包含 #17 关键约束自检条目', () => {
            expect(DEFAULT_GEOGEBRA_PROMPT).toContain('17. **Text 提示词避让图形**');
            expect(DEFAULT_GEOGEBRA_PROMPT).toContain('Text 坐标是否在边缘边距区');
        });
    });
```

- [ ] **Step 2: 跑测试确认规则 2 失败**

Run: `cd E:/2026_wrong-notebook-LB-deploy && npx vitest run src/__tests__/unit/ai/geogebra-prompt-visual-rules.test.ts`
Expected: 规则 1 的 4 个 PASS，规则 2 的 4 个 FAIL。

- [ ] **Step 3: 在文本条目末尾追加规则文本**

`src/lib/ai/prompts.ts:567` 是 `- 文本：Text("说明文字", (x, y))`。该行无额外说明，直接在行尾追加规则文本。

old_string（唯一）:
```
- 文本：Text("说明文字", (x, y))
```

new_string:
```
- 文本：Text("说明文字", (x, y))  --  坐标必须放在视图最上方或最下方的边距区（y 接近 yMax 或 yMin 但不超出 setCoordSystem 范围），不得压在图形主体上。定位机制差异：Text 坐标随视图缩放/平移移动，Slider 是 applet 内置 UI 不随数学坐标移动，两者机制不同，故 Text 不得试图靠近 Slider，而应独立放视图边缘。
```

- [ ] **Step 4: 在「关键约束」清单 #16 之后续编 #17**

old_string（Task 1 新增的 #16 结尾 + 模板结束反引号，唯一）:
```
吐 commands 前自检：派生顶点落点是否与原图一致？`;
```

new_string:
```
吐 commands 前自检：派生顶点落点是否与原图一致？
17. **Text 提示词避让图形**：Text("…", (x, y)) 坐标必须落在视图最上方或最下方的边距区，不得压在图形主体上。吐 commands 前自检：Text 坐标是否在边缘边距区？`;
```

- [ ] **Step 5: 跑测试确认规则 2 通过**

Run: `cd E:/2026_wrong-notebook-LB-deploy && npx vitest run src/__tests__/unit/ai/geogebra-prompt-visual-rules.test.ts`
Expected: 规则 1 + 规则 2 共 8 个 PASS。

- [ ] **Step 6: 跑全量 unit 测试确认无回归**

Run: `cd E:/2026_wrong-notebook-LB-deploy && npx vitest run src/__tests__/unit`
Expected: 全绿。

---

## Task 3: 补充规则 3——关键点深色+放大增强标签可读性（问题 3）

**Files:**
- Modify: `src/lib/ai/prompts.ts:583`（`setPointSize` 条目说明末尾追加规则文本）
- Modify: `src/lib/ai/prompts.ts`（「关键约束」清单末尾，#17 之后续编 #18）
- Test: `src/__tests__/unit/ai/geogebra-prompt-visual-rules.test.ts`（追加规则 3 的断言）

**Interfaces:**
- Consumes: Task 2 产出的 prompt 文本（含 #16/#17）
- Produces: prompt 含关键点深色+放大规则文本与 #18 自检条目；三条视觉规则全部到位

- [ ] **Step 1: 追加失败测试（规则 3 关键句）**

在测试文件 `describe('DEFAULT_GEOGEBRA_PROMPT 视觉呈现规则', ...)` 内、规则 2 的 describe 块之后追加：

```typescript
    describe('规则 3：关键点深色+放大增强标签可读性', () => {
        it('应要求关键点 setColor 深色 + setPointSize(5)', () => {
            expect(DEFAULT_GEOGEBRA_PROMPT).toContain('setColor');
            expect(DEFAULT_GEOGEBRA_PROMPT).toContain('setPointSize');
            expect(DEFAULT_GEOGEBRA_PROMPT).toContain('5)');
        });

        it('应说明标签文字颜色无法用命令直接改', () => {
            expect(DEFAULT_GEOGEBRA_PROMPT).toContain('标签文字颜色无法用命令直接改');
        });

        it('应说明靠点本身深色+放大间接增强', () => {
            expect(DEFAULT_GEOGEBRA_PROMPT).toContain('间接增强');
        });

        it('应包含 #18 关键约束自检条目', () => {
            expect(DEFAULT_GEOGEBRA_PROMPT).toContain('18. **关键点深色+放大**');
            expect(DEFAULT_GEOGEBRA_PROMPT).toContain('关键点是否都设了深色+放大');
        });
    });
```

- [ ] **Step 2: 跑测试确认规则 3 失败**

Run: `cd E:/2026_wrong-notebook-LB-deploy && npx vitest run src/__tests__/unit/ai/geogebra-prompt-visual-rules.test.ts`
Expected: 规则 1+2 共 8 个 PASS，规则 3 的 4 个 FAIL。

- [ ] **Step 3: 在 setPointSize 条目末尾追加规则文本**

`src/lib/ai/prompts.ts:583` 是 `- setPointSize("对象名", 5)  -- 设置点大小`。

old_string（唯一）:
```
- setPointSize("对象名", 5)  -- 设置点大小
```

new_string:
```
- setPointSize("对象名", 5)  -- 设置点大小。所有关键点（题目出现的 A/B/C/D 等点名）必须 setColor("名", 深色) + setPointSize("名", 5)（深色取黑 0, 0, 0 或深红 200, 30, 30 等），让点本身显眼。GeoGebra 标签文字颜色无法用命令直接改（applet 默认灰），只能靠点本身深色+放大间接增强标签可读性。
```

- [ ] **Step 4: 在「关键约束」清单 #17 之后续编 #18**

old_string（Task 2 新增的 #17 结尾 + 模板结束反引号，唯一）:
```
吐 commands 前自检：Text 坐标是否在边缘边距区？`;
```

new_string:
```
吐 commands 前自检：Text 坐标是否在边缘边距区？
18. **关键点深色+放大**：题目出现的所有点名必须 setColor(深色) + setPointSize(5)，间接增强标签可读性。吐 commands 前自检：关键点是否都设了深色+放大？`;
```

- [ ] **Step 5: 跑测试确认规则 3 通过**

Run: `cd E:/2026_wrong-notebook-LB-deploy && npx vitest run src/__tests__/unit/ai/geogebra-prompt-visual-rules.test.ts`
Expected: 12 个测试全 PASS。

- [ ] **Step 6: 跑全量 unit 测试确认无回归**

Run: `cd E:/2026_wrong-notebook-LB-deploy && npx vitest run src/__tests__/unit`
Expected: 全绿。

- [ ] **Step 7: 跑 lint 确认无语法/风格问题**

Run: `cd E:/2026_wrong-notebook-LB-deploy && npm run lint`
Expected: 无 error。若有 prompt 字符串内的中文标点告警，属误报，不改 prompt 内容（prompt 是给 AI 读的中文文本，非代码逻辑）。

---

## Task 4: 人工验证 + 收尾

**Files:**
- 无文件改动；仅运行验证

**Interfaces:**
- Consumes: Task 1-3 产出的完整 prompt（含 #16/#17/#18）

- [ ] **Step 1: 启动 dev server**

Run: `cd E:/2026_wrong-notebook-LB-deploy && npm run dev`（后台运行）

- [ ] **Step 2: 重新生成目标题目的 GeoGebra 命令**

浏览器打开 `http://localhost:3000/error-items/cmsowkw4j00096obiiyvir957`，触发 GeoGebra 分析，确认三点：
1. **顶点方位与原图一致**：三角形 ABC 的 A 在顶、B 在左、C 在右，D 在 AC 右外侧（不再把顶点 A 当底边端点）。
2. **Text 在边缘**：提示词文本落在视图最上方或最下方的边距区，不压在图形上，拖动滑块不遮挡图形。
3. **关键点深色+放大**：A/B/C/D 点为深色、size=5，标签可读性明显改善。

注：LLM 有非确定性，若一次生成仍不理想，重试 1-2 次（prompt 规则是 best-effort，与现有几何约束规则同范式）。

- [ ] **Step 3: 停 dev server**

停掉后台 dev 进程。

- [ ] **Step 4: 更新项目记忆**

更新 `C:\Users\niuyi\.claude\projects\E--2026-wrong-notebook-LB-deploy\memory\geogebra-prompt-visual-blindspot.md`：在「How to apply」段末尾追加一句「**已修复（2026-08-12）**：DEFAULT_GEOGEBRA_PROMPT 已补三条视觉规则 + #16/#17/#18 自检条目，纯 prompt 改动，未动 service 层/前端。遗留：标签文字颜色根治与 Text 真正跟随 Slider 仍需前端层改动，本次未做。」

---

## Self-Review

**1. Spec coverage（spec 三处补充 + 自检整合 + 验证）：**
- 补充 1（顶点方位，spec L38-48）→ Task 1 ✓
- 补充 2（Text 边缘，spec L50-60）→ Task 2 ✓
- 补充 3（深色+放大，spec L62-72）→ Task 3 ✓
- 自检清单整合（spec L74-76，#16/#17/#18 并入「关键约束」末尾）→ Task 1/2/3 各续编一条 ✓
- 验证方式（spec L78-82：文档级测试 + 人工验证 + 回归）→ Task 1-3 测试 + Task 4 人工验证 + 各 Task Step 6 全量回归 ✓
- 不改动项（spec L27-32）→ Global Constraints + 各 Task 仅改 prompts.ts ✓
- 遗留项（spec L84-88）→ Task 4 Step 4 记忆更新注明 ✓

**2. Placeholder scan：** 无 TBD/TODO；每个 Edit 的 old_string/new_string 都是完整可执行文本；测试代码完整。✓

**3. Type consistency：** 全程操作 `DEFAULT_GEOGEBRA_PROMPT` 字符串常量，测试 `import { DEFAULT_GEOGEBRA_PROMPT } from '@/lib/ai/prompts'` 与现有 `ai-prompts.test.ts` 的 import 风格一致；#16/#17/#18 编号连续无跳号。✓

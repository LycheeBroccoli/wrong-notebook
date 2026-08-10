import type { GeogebraAnalysisResult } from "./types";

/**
 * GeoGebra 命令后处理模块
 *
 * AI 生成的 GeoGebra 命令系统性缺失关键命令（setLabelVisible / setAxisLabels /
 * setAxisSteps），且 LLM 非确定性，光改 prompt 无法保证。本模块在 service 层对
 * AI 产出做确定性兜底，覆盖两个 route 调用方（error-items/[id]/geogebra 写 DB
 * + geogebra-analyze 预览直返前端）。
 *
 * 不变量：normalizeGeogebraCommands 幂等（跑两次结果不变）、非破坏性（不丢/改
 * 已有命令，只追加/补全缺失项）。
 */

// ── 点检测 ──────────────────────────────────────────────────────────────
// 两种点创建形式：
//   1. 字面坐标元组：A = (-2, 2) / M' = (1.5, 0.5) / A_1 = (3, 4)
//      守卫：括号内必须是 number, number，排除 g = (x^2+1) 这类函数定义误判
//      （向量 v = (1,2) 仍会匹配——显示向量标签也合理，良性）
//   2. 点返回函数：P = Intersect(f, g) / P = Midpoint(A, B) / P = Reflect(A, l) ...
//      覆盖 prompt 菜单教 AI 用的所有点创建形式（解析几何题 Intersect 是标准做法）
// 名字捕获 [\w']* 支持撇号（A'/M'）和下标（A_1）。
const POINT_TUPLE_RE = /^([A-Za-z_][\w']*)\s*=\s*\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)/;
const POINT_FUNC_RE = /^([A-Za-z_][\w']*)\s*=\s*(?:Point|PointIn|PointOn|Midpoint|Intersect|Reflect|Rotate|Translate|Dilate|Centroid|ClosestPoint|Foot)\s*\(/;

// 已有 setLabelVisible 的检测：匹配方法名 + 第一参数（到第一个逗号为止），
// 再在 JS 里剥引号。用正则 [^"'] 排除两种引号会切坏撇号名（A' 被截成 A），
// 所以这里只锚定方法头，点名提取交给 JS 处理。
const EXISTING_LABEL_RE = /^setLabelVisible\s*\(\s*(.+?)\s*,/i;

// view 1 是否已配置刻度间距 / 轴名（view-1 专属，不误判 view 3）
const HAS_AXIS_STEPS_V1_RE = /^setAxisSteps\s*\(\s*1\s*,/i;
const HAS_AXIS_LABELS_V1_RE = /^setAxisLabels\s*\(\s*1\s*,/i;

const CANONICAL_AXIS_STEPS = "setAxisSteps(1, 1, 1, 1)";
const CANONICAL_AXIS_LABELS = 'setAxisLabels(1, "x", "y", "")';

/**
 * 从命令列表中检测所有被创建的点名。
 * 返回按首次出现顺序的去重点名数组。
 */
function detectPointNames(commands: string[]): string[] {
    const names: string[] = [];
    const seen = new Set<string>();
    for (const cmd of commands) {
        const trimmed = cmd.trim();
        const m = trimmed.match(POINT_TUPLE_RE) || trimmed.match(POINT_FUNC_RE);
        if (m) {
            const name = m[1];
            if (!seen.has(name)) {
                seen.add(name);
                names.push(name);
            }
        }
    }
    return names;
}

/**
 * 收集已存在的 setLabelVisible 目标点名（quote+case 不敏感去重用）。
 * 返回小写、去引号后的点名集合。
 * 在 JS 里剥引号（而非正则 [^"']），避免撇号名 A' 被截成 A 导致去重失效。
 */
function collectExistingLabels(commands: string[]): Set<string> {
    const existing = new Set<string>();
    for (const cmd of commands) {
        const m = cmd.trim().match(EXISTING_LABEL_RE);
        if (m) {
            let name = m[1].trim();
            // 剥首尾引号（双引号或单引号），支持撇号名 "M'"
            if ((name.startsWith('"') && name.endsWith('"')) ||
                (name.startsWith("'") && name.endsWith("'"))) {
                name = name.slice(1, -1);
            }
            existing.add(name.toLowerCase());
        }
    }
    return existing;
}

/**
 * 后处理 GeoGebra 命令，补全系统性缺失项。
 *
 * 1. view-setup 补全：view 1 若无 setAxisSteps/setAxisLabels，在最前插入规范值
 *    （不 strip AI 已有的——尊重 AI 显式选择；仅补缺失）。
 * 2. 点标签补全：检测所有点创建命令，对无 setLabelVisible 的点在末尾追加
 *    setLabelVisible("<name>", true)（双引号包名，撇号名 M' 必须双引号）。
 *
 * 幂等：再跑一次不会重复追加（去重 + ensure-exists）。
 * 非破坏：不修改/删除任何已有命令。
 */
export function normalizeGeogebraCommands(commands: string[]): string[] {
    // 空值守卫：不适用/空结果不凭空加 view-setup
    if (!commands.length) return commands;

    const result = [...commands];

    // ── 1. view-setup 补全（ensure-exists，view 1 专属）──────────────────
    const hasAxisStepsV1 = result.some((c) => HAS_AXIS_STEPS_V1_RE.test(c.trim()));
    const hasAxisLabelsV1 = result.some((c) => HAS_AXIS_LABELS_V1_RE.test(c.trim()));

    // 规范命令插到最前；两条都缺时按 steps→labels 顺序插（与手调参考集一致）
    const toPrepend: string[] = [];
    if (!hasAxisStepsV1) toPrepend.push(CANONICAL_AXIS_STEPS);
    if (!hasAxisLabelsV1) toPrepend.push(CANONICAL_AXIS_LABELS);
    if (toPrepend.length) result.unshift(...toPrepend);

    // ── 2. 点标签补全 ────────────────────────────────────────────────────
    const pointNames = detectPointNames(result);
    if (pointNames.length === 0) return result;

    const existingLabels = collectExistingLabels(result);

    const toAppend: string[] = [];
    for (const name of pointNames) {
        if (!existingLabels.has(name.toLowerCase())) {
            // 双引号包名：撇号名 M' 必须双引号，前端 parseApiArgs 的 slice(1,-1)
            // 才能正确取出 M'（单引号包 M' 会被前端当作字符串边界误切）
            toAppend.push(`setLabelVisible("${name}", true)`);
            existingLabels.add(name.toLowerCase()); // 防同名列内重复
        }
    }
    if (toAppend.length) result.push(...toAppend);

    return result;
}

/**
 * 从 AI 原始响应文本解析出 GeogebraAnalysisResult，并跑 normalize。
 *
 * 抽取三个 provider 共有的"去 markdown 代码块 + 抽 JSON 对象 + parse"逻辑。
 * 解析失败抛错（由 provider 的 handleError 转 AI_* 错误码）。
 */
export function parseGeogebraResponse(rawText: string): GeogebraAnalysisResult {
    if (!rawText) throw new Error("Empty response from AI");

    // Extract JSON from response (handle possible markdown code blocks)
    let jsonStr = rawText.trim();
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
        jsonStr = jsonMatch[1].trim();
    }

    // Try to find JSON object
    const objStart = jsonStr.indexOf("{");
    const objEnd = jsonStr.lastIndexOf("}");
    if (objStart !== -1 && objEnd !== -1) {
        jsonStr = jsonStr.substring(objStart, objEnd + 1);
    }

    const parsed = JSON.parse(jsonStr);

    const suitable = Boolean(parsed.suitable);
    const commands = Array.isArray(parsed.commands)
        ? parsed.commands.filter((c: unknown): c is string => typeof c === "string" && c.trim() !== "")
        : [];
    const description = parsed.description || "";

    // 不适用的结果原样返回（不 normalize，避免给空 commands 凭空加 view-setup）
    if (!suitable || commands.length === 0) {
        return { suitable, commands, description };
    }

    return {
        suitable,
        commands: normalizeGeogebraCommands(commands),
        description,
    };
}

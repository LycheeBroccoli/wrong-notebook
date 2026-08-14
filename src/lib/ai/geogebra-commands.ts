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

// setCoordSystem(x1, x2, y1, y2) 解析。大小写不敏感（AI 产出可能是 PascalCase
// SetCoordSystem 或小写 setCoordSystem；prompt 示例用小写，前端 isApiCall 的
// API_PREFIXES 不含 setcoordsystem，故该命令走 evalCommand 分支，DSL 要求
// PascalCase——但 AI 实际几乎都写小写，前端能跑说明 evalCommand 容忍小写或
// GeoGebra 内部兼容。此处只做文本匹配与改写，不关心执行路径）。
const COORD_SYSTEM_RE = /^setCoordSystem\s*\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)/i;

// 等比容差：小于此差值视为已等比（避免浮点噪声触发无谓改写）。
// 1 个坐标单位的差异在正方形视图下足以让圆变椭圆，故容差远小于 1。
const COORD_EQUAL_TOL = 0.01;

/**
 * 将 setCoordSystem(x1,x2,y1,y2) 的 x/y 范围归一化为等长。
 *
 * 根因背景：前端 geogebra-demo.tsx 的"方案 C+"用动态正方形视图（width=height=
 * side）保证 x/y 像素数相同。但"像素等比"只在"坐标范围也等长"时才让圆/正方形
 * 不变形——若 y 范围比 x 短，同样像素表示更少 y 单位 → 每单位 y 像素更多 → 圆被
 * 纵向拉成椭圆。AI 常按题目几何形状自由选范围（如圆题 -6,6,-5,6），prompt 未
 * 强制等比，故在此确定性兜底。
 *
 * 策略：取较长轴的范围，把较短轴**居中扩展**到等长（保持较短轴的中心点不变）。
 * 扩展只增边距、不裁剪图形，安全。幂等：已等比的命令原样返回。
 *
 * 返回改写后的命令字符串；若已等比或无法解析，返回原命令。
 */
function equalizeCoordSystem(cmd: string): string {
    const m = cmd.match(COORD_SYSTEM_RE);
    if (!m) return cmd;
    const x1 = parseFloat(m[1]), x2 = parseFloat(m[2]);
    const y1 = parseFloat(m[3]), y2 = parseFloat(m[4]);
    const xRange = x2 - x1;
    const yRange = y2 - y1;
    if (Math.abs(xRange - yRange) < COORD_EQUAL_TOL) return cmd;
    // 取较长范围，扩展较短轴（居中保持其中心）
    const target = Math.max(xRange, yRange);
    const half = target / 2;
    let nx1 = x1, nx2 = x2, ny1 = y1, ny2 = y2;
    if (xRange < yRange) {
        const xc = (x1 + x2) / 2;
        nx1 = xc - half; nx2 = xc + half;
    } else {
        const yc = (y1 + y2) / 2;
        ny1 = yc - half; ny2 = yc + half;
    }
    // 格式化：去浮点噪声（如 -5.5000000001 → -5.5），整数去尾 .0
    const fmt = (n: number) => String(Math.round(n * 1e6) / 1e6);
    return `setCoordSystem(${fmt(nx1)}, ${fmt(nx2)}, ${fmt(ny1)}, ${fmt(ny2)})`;
}

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

    // ── 0. setCoordSystem 等比归一化（圆/正方形不变形）────────────────────
    // 必须在 view-setup 补全之前跑：补全逻辑只 ensure-exists setAxisSteps/
    // setAxisLabels，不碰 setCoordSystem；等比归一化改写 AI 的 setCoordSystem
    // 本身。两者作用对象不重叠，顺序无依赖，但放最前语义清晰。
    for (let i = 0; i < result.length; i++) {
        if (COORD_SYSTEM_RE.test(result[i].trim())) {
            result[i] = equalizeCoordSystem(result[i]);
        }
    }

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

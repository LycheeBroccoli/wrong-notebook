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
const POINT_FUNC_RE = /^([A-Za-z_][\w']*)\s*=\s*(?:Point|PointIn|PointOn|Midpoint|Intersect|Reflect|Rotate|Translate|Dilate|Centroid|ClosestPoint|Foot|Element)\s*\(/;

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

// ── Round 去除（applet 5.4.920.0 不认 Round，见记忆 geogebra-command-facts-verified）──
// 匹配 Text(...) 命令，在其内部把 Round(EXPR, N) 改写为 EXPR（去外壳留内部表达式）。
// EXPR 可含嵌套括号（如 Round(Distance(D, A) + Distance(D, C), 2)），需配对括号匹配。
const TEXT_CMD_RE = /^(\w+)\s*=\s*Text\s*\(/i;

// ── Intersect 多交点列表加花括号（web evalCommand 不自动收列表，见记忆）──
// 匹配 listX = Intersect(...) 形式（list 前缀变量是交点列表，非单点）。
// list 前缀约定与 detectPointNames 的列表跳过逻辑一致。
const LIST_INTERSECT_RE = /^(list\w*)\s*=\s*(\{?Intersect\s*\()/i;

// ── Polygon 点列表形式检测（区分 Polygon(A,B,C) 点列表 vs Polygon(A,B,3) n-gon）──
// n-gon 末参是纯数字 n（正多边形构造，顶点自动派生命名，不可加 Segment 兜底）。
// 点列表形式末参是点名，追加 Segment 兜底边（Polygon 静默失败时靠 Segment 画边）。
const POLYGON_ASSIGN_RE = /^(\w+)\s*=\s*Polygon\s*\(/i;
const NUMERIC_LITERAL_RE = /^-?\d+(?:\.\d+)?$/;

/**
 * 从某个开括号位置开始，找到其配对的闭括号位置（返回闭括号在字符串中的索引）。
 * 正确处理嵌套括号与双引号字符串字面量（双引号内的括号不计）。
 * 找不到配对返回 -1。
 *
 * 用于 Round/Intersect/Polygon 等含嵌套括号的命令解析——简单正则无法处理
 * 嵌套，必须显式括号匹配。
 *
 * 注意：只把双引号 " 当作字符串字面量分隔符，**不**把单引号 ' 当作分隔符。
 * 因为 GeoGebra DSL 里单引号是变换点命名的合法后缀（A'/M'/B'），不是字符串
 * 边界——若把 ' 当字符串分隔符，Polygon(A', B', C') 的点名会被误切，导致
 * 顶点解析失败、Segment 兜底丢失。GeoGebra 文本字符串用双引号（Text("...")）。
 */
function findMatchingClose(s: string, openIdx: number, open = "(", close = ")"): number {
    let depth = 0;
    let inStr = false;
    for (let i = openIdx; i < s.length; i++) {
        const ch = s[i];
        if (inStr) {
            if (ch === '"') inStr = false;
            continue;
        }
        if (ch === '"') { inStr = true; continue; }
        if (ch === open) depth++;
        else if (ch === close) {
            depth--;
            if (depth === 0) return i;
        }
    }
    return -1;
}

/**
 * 在 Text(...) 命令内去除 Round(EXPR, N) 外壳，保留 EXPR。
 *
 * 根因：applet 5.4.920.0 的 evalCommand 不认 Round（官网手册无 Round，只有
 * Numeric(<expr>, <sig-figs>)，但 sig-figs 语义≠小数位）。AI prompt 教
 * Round(num, decimals) 导致 Text 命令失败。最小实验验证：去 Round 留原始精度
 * expr 即可跑通（Text 显示原始精度数值）。
 *
 * 只处理 Text(...) 命令内的 Round（显示精度用途）。独立 x = Round(...) 赋值
 * 语义不同且罕见，不在本轮范围。
 *
 * 幂等：无 Round 的 Text 不被匹配，原样返回。非破坏：只改写含 Round 的 Text。
 */
function stripRoundFromText(cmd: string): string {
    const trimmed = cmd.trim();
    // 只处理 Text(...) 赋值命令
    if (!TEXT_CMD_RE.test(trimmed)) return cmd;
    // 在命令里逐个找 Round( ，配对括号定位 EXPR 与 N，改写为 EXPR
    let result = cmd;
    // 循环改写（一个 Text 可能含多个 Round，如 text = "a" + Round(x,2) + "b" + Round(y,2)）
    // 每次从剩余串头部找第一个 Round(，改写后串变短，继续直到无 Round。
    // 注意：必须用不带 g 标志的 match（或 exec）才能拿到 .index；带 g 标志的
    // String.match 返回纯字符串数组、无 .index，会导致改写逻辑失效。
    const singleRoundRe = /\bRound\s*\(/i;
    for (let guard = 0; guard < 32; guard++) { // 上限防意外死循环
        const m = result.match(singleRoundRe);
        if (!m) break;
        const roundIdx = m.index! + m[0].length - 1; // 指向 Round 后的 '('
        const closeIdx = findMatchingClose(result, roundIdx);
        if (closeIdx === -1) break; // 括号不配对，放弃改写（保持原样，让 evalCommand 报错）
        // 提取括号内全部内容，再找最后一个顶层逗号分隔 EXPR 与 N
        const inner = result.substring(roundIdx + 1, closeIdx);
        const commaIdx = findTopLevelComma(inner);
        if (commaIdx === -1) break; // Round 只有一参？非预期，放弃
        const expr = inner.substring(0, commaIdx).trim();
        // 用 EXPR 替换整个 Round(...) 调用
        const before = result.substring(0, m.index!);
        const after = result.substring(closeIdx + 1);
        result = before + expr + after;
    }
    return result;
}

/**
 * 在字符串中找到"顶层"逗号（深度为 0 的第一个逗号），用于分离 Round(EXPR, N)
 * 的两参。忽略双引号字符串字面量内的逗号。找不到返回 -1。
 * 单引号不当字符串分隔符（GeoGebra 里 ' 是点名后缀 A'/M'，见 findMatchingClose）。
 */
function findTopLevelComma(s: string): number {
    let depth = 0;
    let inStr = false;
    for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (inStr) {
            if (ch === '"') inStr = false;
            continue;
        }
        if (ch === '"') { inStr = true; continue; }
        if (ch === "(") depth++;
        else if (ch === ")") depth--;
        else if (ch === "," && depth === 0) return i;
    }
    return -1;
}

/**
 * 把 listX = Intersect(...) 改写为 listX = {Intersect(...)}（加花括号收列表）。
 *
 * 根因：web applet 的 evalCommand 不会把 Intersect 的多输出自动收进列表，
 * 必须显式花括号 {Intersect(...)} 才形成列表，否则 Element(list, n) 失败
 * 级联（见记忆 geogebra-ggb-xml-vs-dsl / geogebra-command-facts-verified）。
 *
 * 只对 list 前缀变量（交点列表约定）加花括号；P = Intersect(f, g) 两线单点
 * 不加（会变成长度 1 的列表，破坏后续点引用）。
 *
 * 幂等：已包花括号的跳过。非破坏：只改写匹配的 list 赋值。
 */
function addBracesToIntersectList(cmd: string): string {
    const trimmed = cmd.trim();
    const m = trimmed.match(LIST_INTERSECT_RE);
    if (!m) return cmd;
    // m[2] 形如 "{Intersect(" 或 "Intersect("；若已含 { 则跳过（幂等）
    if (m[2].startsWith("{")) return cmd;
    // 找到 Intersect( 的位置（在原 cmd 里）。注意 trimmed 与 cmd 的索引可能
    // 因前导空格不同，但 AI 产出几乎无前导空格；为稳妥，在 cmd 上重新定位。
    const intersectStart = cmd.indexOf("Intersect(");
    if (intersectStart === -1) return cmd;
    const openParen = intersectStart + "Intersect(".length - 1; // '(' 的索引
    const closeIdx = findMatchingClose(cmd, openParen);
    if (closeIdx === -1) return cmd;
    // 在 Intersect( 前插 {，在配对 ) 后插 }
    const before = cmd.substring(0, intersectStart); // 赋值号后到 Intersect 前
    const intersectCall = cmd.substring(intersectStart, closeIdx + 1);
    const after = cmd.substring(closeIdx + 1);
    return before + "{" + intersectCall + "}" + after;
}

/**
 * 解析 Polygon(...) 命令，返回其顶点参数列表（点列表形式）或 null（n-gon 形式）。
 *
 * n-gon（Polygon(A, B, 3)）末参是纯数字 n，顶点由 GeoGebra 自动派生命名，
 * AI 不一定显式定义，加 Segment 会引用未定义点 → 返回 null 跳过。
 * 点列表形式（Polygon(A, B, C)）末参是点名，返回全部点名（如 ["A","B","C"]）。
 */
function parsePolygonVertices(cmd: string): string[] | null {
    const trimmed = cmd.trim();
    const m = trimmed.match(POLYGON_ASSIGN_RE);
    if (!m) return null;
    const openParen = trimmed.indexOf("Polygon(") + "Polygon(".length - 1;
    const closeIdx = findMatchingClose(trimmed, openParen);
    if (closeIdx === -1) return null;
    const inner = trimmed.substring(openParen + 1, closeIdx);
    // 按顶层逗号分割参数
    const params = splitTopLevelComma(inner);
    if (params.length < 3) return null; // Polygon 至少 3 参
    // 末参是纯数字 → n-gon，跳过
    const lastParam = params[params.length - 1].trim();
    if (NUMERIC_LITERAL_RE.test(lastParam)) return null;
    // 点列表形式：每个参数是一个点名（trim 后）
    return params.map(p => p.trim()).filter(p => p.length > 0);
}

/**
 * 按顶层逗号分割字符串（忽略嵌套括号与双引号字符串字面量内的逗号）。
 * 单引号不当字符串分隔符（GeoGebra 里 ' 是点名后缀 A'/M'，见 findMatchingClose）。
 */
function splitTopLevelComma(s: string): string[] {
    const parts: string[] = [];
    let depth = 0;
    let inStr = false;
    let start = 0;
    for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (inStr) {
            if (ch === '"') inStr = false;
            continue;
        }
        if (ch === '"') { inStr = true; continue; }
        if (ch === "(") depth++;
        else if (ch === ")") depth--;
        else if (ch === "," && depth === 0) {
            parts.push(s.substring(start, i));
            start = i + 1;
        }
    }
    parts.push(s.substring(start));
    return parts;
}

/**
 * 把点名转成合法的 GeoGebra 对象名片段（撇号 → 下划线）。
 * 如 A' → A_，B' → B_，故 Segment(A', B') 的兜底对象名拼成 segA_B_。
 * 对象名不含撇号（撇号在对象名里合法性未验证，规避）；Segment 参数仍用原撇号点名。
 */
function nameForSegmentObj(name: string): string {
    return name.replace(/'/g, "_");
}

/**
 * 收集命令列表中所有已存在的 Segment(X, Y) 边对（去序、去引号）。
 * 返回 Set，元素为 "min,max" 形式（按字母序排序两端点，使 Segment(A,B) 与
 * Segment(B,A) 视为同一条边）。用于 Polygon 兜底的幂等去重。
 */
function collectExistingSegmentEdges(commands: string[]): Set<string> {
    const edges = new Set<string>();
    const segRe = /=\s*Segment\s*\(\s*([^,]+?)\s*,\s*([^)]+?)\s*\)/i;
    for (const cmd of commands) {
        const m = cmd.trim().match(segRe);
        if (m) {
            // 只剥双引号（Segment 的点名参数几乎不加引号，但防御性剥）；
            // 不剥单引号——' 是点名后缀 A'/M'，剥了会让 A' 与 A 误判为同一边
            const a = m[1].trim().replace(/^"|"$/g, "");
            const b = m[2].trim().replace(/^"|"$/g, "");
            const key = [a, b].sort().join("|");
            edges.add(key);
        }
    }
    return edges;
}

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
            // Intersect(circle, circle) 返回列表而非点，AI 按约定以 "list" 前缀命名
            // 这些列表变量不应被当作点加 setLabelVisible（给列表设标签会报错）
            if (/^list/i.test(name)) continue;
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

    // ── 0a. Round 去除（Text 命令内）────────────────────────────────────
    // applet 5.4.920.0 不认 Round，Text(... Round(X, n) ...) 会失败。
    // 去 Round 外壳留 X（原始精度）。幂等：无 Round 的 Text 不动。
    for (let i = 0; i < result.length; i++) {
        result[i] = stripRoundFromText(result[i]);
    }

    // ── 0b. Intersect 多交点列表加花括号 ────────────────────────────────
    // listX = Intersect(...) → listX = {Intersect(...)}，否则变量非列表、
    // Element 取元素失败级联。只对 list 前缀变量；已包花括号跳过（幂等）。
    for (let i = 0; i < result.length; i++) {
        result[i] = addBracesToIntersectList(result[i]);
    }

    // ── 0c. Polygon 点列表形式追加 Segment 兜底边 ─────────────────────────
    // Polygon(A,B,C) 在本 applet 确定性静默失败（t1 不进 allNames、无自动边），
    // 追加显式 Segment 兜底画三角形/多边形边。n-gon（Polygon(A,B,3)）跳过。
    // 幂等：已存在的边对（含 AI 显式画的 + 上轮追加的）不重复。
    const existingEdges = collectExistingSegmentEdges(result);
    const toInsert: { idx: number; cmds: string[] }[] = [];
    for (let i = 0; i < result.length; i++) {
        const verts = parsePolygonVertices(result[i]);
        if (!verts) continue;
        // 闭合多边形：N 顶点 N 条边（含末→首闭合边）
        const newSegs: string[] = [];
        for (let j = 0; j < verts.length; j++) {
            const a = verts[j];
            const b = verts[(j + 1) % verts.length];
            const key = [a, b].sort().join("|");
            if (existingEdges.has(key)) continue; // 该边已存在，跳过
            existingEdges.add(key); // 防同 Polygon 内重复边 + 标记本轮已加
            const objName = `seg${nameForSegmentObj(a)}${nameForSegmentObj(b)}`;
            newSegs.push(`${objName} = Segment(${a}, ${b})`);
        }
        if (newSegs.length) toInsert.push({ idx: i, cmds: newSegs });
    }
    // 从后往前插入，避免索引偏移（每个 Polygon 紧后插其兜底 Segment）
    for (let k = toInsert.length - 1; k >= 0; k--) {
        const { idx, cmds } = toInsert[k];
        result.splice(idx + 1, 0, ...cmds);
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

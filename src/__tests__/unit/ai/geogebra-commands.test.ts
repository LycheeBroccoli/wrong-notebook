/**
 * GeoGebra 命令后处理单元测试
 * 测试 normalizeGeogebraCommands / parseGeogebraResponse
 */
import { describe, it, expect } from 'vitest';
import { normalizeGeogebraCommands, parseGeogebraResponse } from '@/lib/ai/geogebra-commands';

// ── Golden master：位似变换题 cmslvr2d5000hwwxbm0yal00b 的 46 条手调命令 ──
// 这是"正确"的命令集，normalize 跑它必须是 no-op（非破坏性 + 幂等）。
const GOLDEN_MASTER = [
    'setAxisSteps(1, 1, 1, 1)',
    'setAxisLabels(1, "x", "y", "")',
    'setCoordSystem(-6, 6, -6, 6)',
    'setAxesVisible(true, true)',
    'setGridVisible(true)',
    'O = (0, 0)',
    'A = (-2, 2)',
    'B = (-4, 0)',
    'C = (-4, -4)',
    't1 = Polygon(A, B, C)',
    "A' = (1, -1)",
    "B' = (2, 0)",
    "C' = (2, 2)",
    "t2 = Polygon(A', B', C')",
    "l_A = Line(A, A')",
    "l_B = Line(B, B')",
    "l_C = Line(C, C')",
    'M = (-3, -1)',
    "M' = (1.5, 0.5)",
    "l_M = Line(M, M')",
    'setColor("t1", 30, 144, 255)',
    'setFilling("t1", 0.25)',
    'setColor("t2", 255, 69, 0)',
    'setFilling("t2", 0.25)',
    'setColor("l_A", 150, 150, 150)',
    'setLineStyle("l_A", 1)',
    'setColor("l_B", 150, 150, 150)',
    'setLineStyle("l_B", 1)',
    'setColor("l_C", 150, 150, 150)',
    'setLineStyle("l_C", 1)',
    'setColor("l_M", 150, 150, 150)',
    'setLineStyle("l_M", 1)',
    'setColor("O", 0, 0, 0)',
    'setColor("M", 138, 43, 226)',
    "setColor(\"M'\", 138, 43, 226)",
    'setPointSize("M", 5)',
    "setPointSize(\"M'\", 5)",
    'setLabelVisible("A", true)',
    'setLabelVisible("B", true)',
    'setLabelVisible("C", true)',
    "setLabelVisible(\"A'\", true)",
    "setLabelVisible(\"B'\", true)",
    "setLabelVisible(\"C'\", true)",
    'setLabelVisible("O", true)',
    'setLabelVisible("M", true)',
    "setLabelVisible(\"M'\", true)",
];

describe('normalizeGeogebraCommands', () => {
    describe('Golden master（非破坏性）', () => {
        it('对已正确的 46 条手调命令应是 no-op（不丢/不改任何命令）', () => {
            const result = normalizeGeogebraCommands(GOLDEN_MASTER);
            // 每条原命令都还在结果里（顺序可能因 prepend 微调，但内容不丢）
            for (const cmd of GOLDEN_MASTER) {
                expect(result).toContain(cmd);
            }
            // 不应新增任何 setLabelVisible（golden master 已覆盖所有点）
            const labelCount = result.filter(c => /^setLabelVisible/i.test(c.trim())).length;
            const goldenLabelCount = GOLDEN_MASTER.filter(c => /^setLabelVisible/i.test(c.trim())).length;
            expect(labelCount).toBe(goldenLabelCount);
        });

        it('幂等：跑两次结果相同', () => {
            const once = normalizeGeogebraCommands(GOLDEN_MASTER);
            const twice = normalizeGeogebraCommands(once);
            expect(twice).toEqual(once);
        });
    });

    describe('退化 AI 输出（补全缺失）', () => {
        it('缺 setLabelVisible/setAxisSteps/setAxisLabels 时补齐，且 setLabelVisible 排在所有点创建之后', () => {
            // 模拟 AI 退化产出：有 setCoordSystem 但缺 axis steps/labels，缺所有 setLabelVisible
            const degraded = [
                'setCoordSystem(-6, 6, -6, 6)',
                'setAxesVisible(true, true)',
                'setGridVisible(true)',
                'O = (0, 0)',
                'A = (-2, 2)',
                'B = (-4, 0)',
                "A' = (1, -1)",
                "t1 = Polygon(A, B, A')",
            ];
            const result = normalizeGeogebraCommands(degraded);

            // view-setup 补全：setAxisSteps / setAxisLabels 在最前
            expect(result[0]).toBe('setAxisSteps(1, 1, 1, 1)');
            expect(result[1]).toBe('setAxisLabels(1, "x", "y", "")');

            // 点标签补全：O/A/B/A' 都有 setLabelVisible
            expect(result).toContain('setLabelVisible("O", true)');
            expect(result).toContain('setLabelVisible("A", true)');
            expect(result).toContain('setLabelVisible("B", true)');
            expect(result).toContain("setLabelVisible(\"A'\", true)");

            // setLabelVisible 必须排在所有点创建之后
            const lastPointCreateIdx = Math.max(
                ...['O = (0, 0)', 'A = (-2, 2)', 'B = (-4, 0)', "A' = (1, -1)"]
                    .map(c => result.lastIndexOf(c))
            );
            const firstLabelIdx = result.findIndex(c => /^setLabelVisible/i.test(c.trim()));
            expect(firstLabelIdx).toBeGreaterThan(lastPointCreateIdx);
        });

        it('部分点已有 setLabelVisible 时只补缺失的，不重复', () => {
            const partial = [
                'setCoordSystem(-6, 6, -6, 6)',
                'A = (1, 2)',
                'B = (3, 4)',
                'setLabelVisible("A", true)', // A 已有
            ];
            const result = normalizeGeogebraCommands(partial);

            // A 不应被重复追加
            const aLabels = result.filter(c => /setLabelVisible\s*\(\s*["']A["']\s*,/i.test(c));
            expect(aLabels.length).toBe(1);
            // B 应被补上
            expect(result).toContain('setLabelVisible("B", true)');
        });
    });

    describe('PointIn 不被处理', () => {
        it('PointIn(t1) 存在时原样保留（后处理不碰 PointIn）', () => {
            const withPointIn = [
                'setCoordSystem(-6, 6, -6, 6)',
                't1 = Polygon((0,0), (2,0), (0,2))',
                'M = PointIn(t1)', // 随机点，后处理检测到 M 名但不动坐标
                'A = (1, 1)',
            ];
            const result = normalizeGeogebraCommands(withPointIn);
            // PointIn 行原样保留
            expect(result).toContain('M = PointIn(t1)');
            // M 仍被加 setLabelVisible（标签该显示，只是位置随机——位置靠 prompt 层管）
            expect(result).toContain('setLabelVisible("M", true)');
            expect(result).toContain('setLabelVisible("A", true)');
        });
    });

    describe('函数定义误判排除', () => {
        it('g = (x^2 + 1) 不应被当作点加 setLabelVisible（坐标元组守卫）', () => {
            const withFunc = [
                'setCoordSystem(-6, 6, -6, 6)',
                'g = (x^2 + 1)', // 函数定义，括号内不是 number,number
                'A = (1, 2)',    // 真点
            ];
            const result = normalizeGeogebraCommands(withFunc);
            // g 不应出现在 setLabelVisible 目标里
            const gLabel = result.find(c => /setLabelVisible\s*\(\s*["']g["']\s*,/i.test(c));
            expect(gLabel).toBeUndefined();
            // A 仍正常
            expect(result).toContain('setLabelVisible("A", true)');
        });
    });

    describe('两圆交点列表不被误判为点（Intersect(circle,circle) 返回列表）', () => {
        it('listD = Intersect(cA, cC) 不应被检测为点（list 前缀变量是列表非点）', () => {
            const cmds = [
                'setCoordSystem(-2, 8, -3, 7)',
                'A = (1, 2)',
                'B = (0, 0)',
                'C = (3, 0)',
                'cA = Circle(A, 3)',
                'cC = Circle(C, 2)',
                'listD = Intersect(cA, cC)',
                'D = Element(listD, 1)',
            ];
            const result = normalizeGeogebraCommands(cmds);
            // listD 不应被加 setLabelVisible（它是列表，不是点）
            const listDLabel = result.find(c => /setLabelVisible\s*\(\s*["']listD["']\s*,/i.test(c));
            expect(listDLabel).toBeUndefined();
            // D 仍应被加 setLabelVisible（D 是点）
            expect(result).toContain('setLabelVisible("D", true)');
        });

        it('两线交点 Intersect(f, g) 仍应被正常检测为点', () => {
            const cmds = [
                'setCoordSystem(-6, 6, -6, 6)',
                'f = x^2',
                'g = 2*x',
                'P = Intersect(f, g)',
            ];
            const result = normalizeGeogebraCommands(cmds);
            // P 是两线交点（点），应被加 setLabelVisible
            expect(result).toContain('setLabelVisible("P", true)');
        });
    });

    describe('撇号/下标名', () => {
        it('撇号名 A\'/M\' 用双引号包，下标 A_1 正常检测', () => {
            const cmds = [
                'setCoordSystem(-6, 6, -6, 6)',
                "A' = (1, -1)",
                "M' = (2, 3)",
                'A_1 = (4, 5)',
            ];
            const result = normalizeGeogebraCommands(cmds);
            expect(result).toContain("setLabelVisible(\"A'\", true)");
            expect(result).toContain("setLabelVisible(\"M'\", true)");
            expect(result).toContain('setLabelVisible("A_1", true)');
        });
    });

    describe('空/不适用输入', () => {
        it('空数组原样返回，不凭空加 view-setup', () => {
            const result = normalizeGeogebraCommands([]);
            expect(result).toEqual([]);
        });
    });

    describe('点返回函数形式', () => {
        it('P = Intersect(f, g) / P = Midpoint(A, B) 被检测并加标签', () => {
            const cmds = [
                'setCoordSystem(-6, 6, -6, 6)',
                'f = x^2',           // 函数，不该被当点
                'g = 2*x',           // 函数，不该被当点
                'P = Intersect(f, g)', // 点返回函数形式
                'Q = Midpoint(A, B)',   // 点返回函数形式（A/B 此处未定义，仅测检测）
            ];
            const result = normalizeGeogebraCommands(cmds);
            expect(result).toContain('setLabelVisible("P", true)');
            expect(result).toContain('setLabelVisible("Q", true)');
            // f/g 不应被当点
            const fLabel = result.find(c => /setLabelVisible\s*\(\s*["']f["']\s*,/i.test(c));
            const gLabel = result.find(c => /setLabelVisible\s*\(\s*["']g["']\s*,/i.test(c));
            expect(fLabel).toBeUndefined();
            expect(gLabel).toBeUndefined();
        });
    });

    describe('setCoordSystem 等比归一化（圆/正方形不变形）', () => {
        it('y 范围比 x 范围短时，y 居中扩展到与 x 等长（圆题 -6,6,-5,6 → -6,6,-5.5,6.5）', () => {
            // 真实 bug 数据：圆 O 题存的是 setCoordSystem(-6, 6, -5, 6)
            // x 范围 12、y 范围 11 → 正方形视图下圆变椭圆（横短竖长）
            const cmds = [
                'setCoordSystem(-6, 6, -5, 6)',
                'setAxesVisible(true, true)',
                'setGridVisible(true)',
                'O = (0, 0)',
                'c = Circle(O, 4)',
            ];
            const result = normalizeGeogebraCommands(cmds);
            // y 中心 0.5，扩到范围 12 → ±6 → -5.5, 6.5（居中保持原 y 中心）
            expect(result).toContain('setCoordSystem(-6, 6, -5.5, 6.5)');
            // 不应残留旧的不等比命令
            expect(result).not.toContain('setCoordSystem(-6, 6, -5, 6)');
        });

        it('x 范围比 y 范围长时，y 居中扩展到与 x 等长', () => {
            // setCoordSystem(-1, 2, -0.5, 1.5)：x 范围 3、y 范围 2 → 扩 y 到 3
            // y 中心 0.5 → ±1.5 → -1, 2
            const cmds = [
                'setCoordSystem(-1, 2, -0.5, 1.5)',
                'A = (0, 0)',
            ];
            const result = normalizeGeogebraCommands(cmds);
            expect(result).toContain('setCoordSystem(-1, 2, -1, 2)');
            expect(result).not.toContain('setCoordSystem(-1, 2, -0.5, 1.5)');
        });

        it('已等比的 setCoordSystem 不被改写（非破坏）', () => {
            const cmds = [
                'setCoordSystem(-6, 6, -6, 6)',
                'A = (1, 2)',
            ];
            const result = normalizeGeogebraCommands(cmds);
            expect(result).toContain('setCoordSystem(-6, 6, -6, 6)');
        });

        it('幂等：跑两次结果相同', () => {
            const cmds = [
                'setCoordSystem(-6, 6, -5, 6)',
                'A = (1, 2)',
            ];
            const once = normalizeGeogebraCommands(cmds);
            const twice = normalizeGeogebraCommands(once);
            expect(twice).toEqual(once);
        });

        it('无 setCoordSystem 时不凭空插入', () => {
            const cmds = ['A = (1, 2)'];
            const result = normalizeGeogebraCommands(cmds);
            // 不应凭空加 setCoordSystem
            const csCmds = result.filter(c => /setCoordSystem/i.test(c.trim()));
            expect(csCmds.length).toBe(0);
        });
    });

    describe('view-setup dedup（view 1 专属）', () => {
        it('已有 setAxisSteps(1, 2, 1, 1) 时不重复插（尊重 AI 显式选择）', () => {
            const cmds = [
                'setAxisSteps(1, 2, 1, 1)', // AI 选了 step=2，view 1
                'setCoordSystem(-6, 6, -6, 6)',
                'A = (1, 2)',
            ];
            const result = normalizeGeogebraCommands(cmds);
            // 不应再插 setAxisSteps(1, 1, 1, 1)
            expect(result).not.toContain('setAxisSteps(1, 1, 1, 1)');
            expect(result).toContain('setAxisSteps(1, 2, 1, 1)');
            // setAxisLabels 仍缺，应被补
            expect(result).toContain('setAxisLabels(1, "x", "y", "")');
        });

        it('已有 setAxisLabels(1,"x","y","") 时不重复插', () => {
            const cmds = [
                'setAxisLabels(1, "x", "y", "")',
                'setCoordSystem(-6, 6, -6, 6)',
                'A = (1, 2)',
            ];
            const result = normalizeGeogebraCommands(cmds);
            const labelsCmds = result.filter(c => /^setAxisLabels/i.test(c.trim()));
            expect(labelsCmds.length).toBe(1);
        });
    });

    // ── 几何约束关系 golden master 集（2026-08-11 直径端点对 bug 回归）──────
    // 每个 golden 数组是该几何模式的"正确"命令集（拓扑序 + 正确约束类型），
    // normalize 跑它必须是 no-op（非破坏）+ 幂等。仿 GOLDEN_MASTER 模式。
    // 目的：锁定正确的构造方式，防止未来 prompt/normalizer 改动破坏这些模式。

    // 圆直径端点对：本次 bug 的正确构造。A=Point(c) 可沿圆拖动，
    // B=Reflect(A,O) 自动是对径点（在圆上、随 A 拖动保持直径）。
    // 关键不变量：A/B 都不能是写死坐标的自由点。
    const CIRCLE_DIAMETER_GOLDEN = [
        'setAxisSteps(1, 1, 1, 1)',
        'setAxisLabels(1, "x", "y", "")',
        'setCoordSystem(-6, 6, -6, 6)',
        'setAxesVisible(true, true)',
        'setGridVisible(true)',
        'O = (0, 0)',
        'c = Circle(O, 2)',
        'A = Point(c)',
        'setCoords("A", -2, 0)',
        'B = Reflect(A, O)',
        'C = Point(c)',
        'setCoords("C", -0.25, 1.984313483298443)',
        'D = Point(c)',
        'setCoords("D", -1.5, 1.3228756555322954)',
        'poly1 = Polygon(A, B, C, D)',
        'setColor("c", 70, 130, 180)',
        'setLineThickness("c", 2)',
        'setColor("poly1", 255, 127, 80)',
        'setFilling("poly1", 0.25)',
        'setLabelVisible("O", true)',
        'setLabelVisible("A", true)',
        'setLabelVisible("B", true)',
        'setLabelVisible("C", true)',
        'setLabelVisible("D", true)',
    ];

    describe('Golden master: 圆直径端点对（A=Point(c), B=Reflect(A,O)）', () => {
        it('对正确的直径端点对构造应是 no-op（不丢/不改任何命令）', () => {
            const result = normalizeGeogebraCommands(CIRCLE_DIAMETER_GOLDEN);
            for (const cmd of CIRCLE_DIAMETER_GOLDEN) {
                expect(result).toContain(cmd);
            }
            // B=Reflect(A,O) 应被 POINT_FUNC_RE 识别为点，自动加 setLabelVisible("B")
            // golden 已含 setLabelVisible("B", true)，故不应重复追加
            const bLabels = result.filter(c => /setLabelVisible\s*\(\s*["']B["']\s*,/i.test(c));
            expect(bLabels.length).toBe(1);
        });

        it('幂等：跑两次结果相同', () => {
            const once = normalizeGeogebraCommands(CIRCLE_DIAMETER_GOLDEN);
            const twice = normalizeGeogebraCommands(once);
            expect(twice).toEqual(once);
        });

        it('Reflect(A, O) 被识别为点返回函数（B 自动加标签）', () => {
            // 去掉 golden 里的 setLabelVisible("B")，normalize 应补上
            const withoutBLabel = CIRCLE_DIAMETER_GOLDEN.filter(
                c => !/setLabelVisible\s*\(\s*["']B["']\s*,/i.test(c)
            );
            const result = normalizeGeogebraCommands(withoutBLabel);
            expect(result).toContain('setLabelVisible("B", true)');
        });
    });

    // 圆上单点（既有模式，确保不被破坏）：A=Point(c) + setCoords 固定初始位置
    const POINT_ON_CIRCLE_GOLDEN = [
        'setAxisSteps(1, 1, 1, 1)',
        'setAxisLabels(1, "x", "y", "")',
        'setCoordSystem(-6, 6, -6, 6)',
        'setAxesVisible(true, true)',
        'setGridVisible(true)',
        'O = (0, 0)',
        'c = Circle(O, 3)',
        'A = Point(c)',
        'setCoords("A", 3, 0)',
        'setColor("c", 70, 130, 180)',
        'setLabelVisible("O", true)',
        'setLabelVisible("A", true)',
    ];

    describe('Golden master: 圆上单点（A=Point(c)+setCoords）', () => {
        it('对正确的圆上点构造应是 no-op', () => {
            const result = normalizeGeogebraCommands(POINT_ON_CIRCLE_GOLDEN);
            for (const cmd of POINT_ON_CIRCLE_GOLDEN) {
                expect(result).toContain(cmd);
            }
        });

        it('幂等', () => {
            const once = normalizeGeogebraCommands(POINT_ON_CIRCLE_GOLDEN);
            const twice = normalizeGeogebraCommands(once);
            expect(twice).toEqual(once);
        });
    });

    // 反射变换点（A'/B'=Reflect，撇号命名）
    const REFLECT_TRANSFORM_GOLDEN = [
        'setAxisSteps(1, 1, 1, 1)',
        'setAxisLabels(1, "x", "y", "")',
        'setCoordSystem(-6, 6, -6, 6)',
        'setAxesVisible(true, true)',
        'setGridVisible(true)',
        'l = x = 0',
        'A = (2, 1)',
        "A' = Reflect(A, l)",
        'B = (2, 3)',
        "B' = Reflect(B, l)",
        "segAA = Segment(A, A')",
        "segBB = Segment(B, B')",
        'setColor("l", 150, 150, 150)',
        'setLineStyle("l", 1)',
        "setLabelVisible(\"A'\", true)",
        "setLabelVisible(\"B'\", true)",
        'setLabelVisible("A", true)',
        'setLabelVisible("B", true)',
    ];

    describe('Golden master: 反射变换点（A\'=Reflect(A,l)）', () => {
        it('对正确的反射变换点构造应是 no-op', () => {
            const result = normalizeGeogebraCommands(REFLECT_TRANSFORM_GOLDEN);
            for (const cmd of REFLECT_TRANSFORM_GOLDEN) {
                expect(result).toContain(cmd);
            }
        });

        it('幂等', () => {
            const once = normalizeGeogebraCommands(REFLECT_TRANSFORM_GOLDEN);
            const twice = normalizeGeogebraCommands(once);
            expect(twice).toEqual(once);
        });

        it('撇号变换点 A\'/B\' 被 POINT_FUNC_RE 识别（Reflect 重载）', () => {
            // 去掉 setLabelVisible("A'")，normalize 应补上（双引号包撇号名）
            const withoutALabel = REFLECT_TRANSFORM_GOLDEN.filter(
                c => !/setLabelVisible\s*\(\s*["']A'["']\s*,/i.test(c)
            );
            const result = normalizeGeogebraCommands(withoutALabel);
            expect(result).toContain("setLabelVisible(\"A'\", true)");
        });
    });

    // 交点：P = Intersect(f, g)
    const INTERSECTION_GOLDEN = [
        'setAxisSteps(1, 1, 1, 1)',
        'setAxisLabels(1, "x", "y", "")',
        'setCoordSystem(-6, 6, -6, 6)',
        'setAxesVisible(true, true)',
        'setGridVisible(true)',
        'f = x^2',
        'g = 2*x',
        'P = Intersect(f, g)',
        'setColor("f", 30, 144, 255)',
        'setColor("g", 255, 69, 0)',
        'setPointSize("P", 5)',
        'setLabelVisible("P", true)',
    ];

    describe('Golden master: 交点（P=Intersect(f,g)）', () => {
        it('对正确的交点构造应是 no-op', () => {
            const result = normalizeGeogebraCommands(INTERSECTION_GOLDEN);
            for (const cmd of INTERSECTION_GOLDEN) {
                expect(result).toContain(cmd);
            }
        });

        it('幂等', () => {
            const once = normalizeGeogebraCommands(INTERSECTION_GOLDEN);
            const twice = normalizeGeogebraCommands(once);
            expect(twice).toEqual(once);
        });

        it('f/g 函数定义不被误判为点', () => {
            const result = normalizeGeogebraCommands(INTERSECTION_GOLDEN);
            const fLabel = result.find(c => /setLabelVisible\s*\(\s*["']f["']\s*,/i.test(c));
            const gLabel = result.find(c => /setLabelVisible\s*\(\s*["']g["']\s*,/i.test(c));
            expect(fLabel).toBeUndefined();
            expect(gLabel).toBeUndefined();
        });
    });

    // 中点：M = Midpoint(A, B)
    const MIDPOINT_GOLDEN = [
        'setAxisSteps(1, 1, 1, 1)',
        'setAxisLabels(1, "x", "y", "")',
        'setCoordSystem(-6, 6, -6, 6)',
        'setAxesVisible(true, true)',
        'setGridVisible(true)',
        'A = (-2, 0)',
        'B = (4, 0)',
        'M = Midpoint(A, B)',
        'segAB = Segment(A, B)',
        'setPointSize("M", 5)',
        'setColor("M", 138, 43, 226)',
        'setLabelVisible("A", true)',
        'setLabelVisible("B", true)',
        'setLabelVisible("M", true)',
    ];

    describe('Golden master: 中点（M=Midpoint(A,B)）', () => {
        it('对正确的中点构造应是 no-op', () => {
            const result = normalizeGeogebraCommands(MIDPOINT_GOLDEN);
            for (const cmd of MIDPOINT_GOLDEN) {
                expect(result).toContain(cmd);
            }
        });

        it('幂等', () => {
            const once = normalizeGeogebraCommands(MIDPOINT_GOLDEN);
            const twice = normalizeGeogebraCommands(once);
            expect(twice).toEqual(once);
        });
    });

    // 自由点必须保持自由：位似中心 M=(-3,-1) 是题目给定的自由参数，
    // normalize 不应把它转成 Point(c) 或别的约束点（normalizer 本来就不改
    // 点创建形式，但此用例锁定该不变量，防止未来误加"自由点转约束点"逻辑）。
    const FREE_POINT_STAYS_FREE = [
        'setAxisSteps(1, 1, 1, 1)',
        'setAxisLabels(1, "x", "y", "")',
        'setCoordSystem(-6, 6, -6, 6)',
        'setAxesVisible(true, true)',
        'setGridVisible(true)',
        'O = (0, 0)',
        'c = Circle(O, 1)',
        'M = (-3, -1)',
        'setLabelVisible("O", true)',
        'setLabelVisible("M", true)',
    ];

    describe('Golden master: 自由点保持自由（M=(-3,-1) 不被转约束）', () => {
        it('自由点 M=(-3,-1) 原样保留，不被转成 Point(c)', () => {
            const result = normalizeGeogebraCommands(FREE_POINT_STAYS_FREE);
            expect(result).toContain('M = (-3, -1)');
            // 不应出现 M = Point(...) 之类改写
            const mAsPoint = result.some(c => /^M\s*=\s*Point/i.test(c.trim()));
            expect(mAsPoint).toBe(false);
        });

        it('幂等', () => {
            const once = normalizeGeogebraCommands(FREE_POINT_STAYS_FREE);
            const twice = normalizeGeogebraCommands(once);
            expect(twice).toEqual(once);
        });
    });

    // ── 第二轮回归（2026-08-11 C 脱离圆周 + OA 箭头 bug）──────────────
    // 根因：AI 把内接点 C 用 Intersect(线,线) 派生（脱离圆周）+ 用 Vector 造 P（OA 带箭头）。
    // 正确构造：C 用垂足对称法（Reflect(B,foot)，C 在圆上 + 不依赖交点索引），
    // P 用 Intersect(l_BA, l_CD) 从前提 C、D 导出（信息单向流：前提→派生）。

    // 圆内接四边形 + 延长线交点：本次第二轮 bug 的正确构造。
    // ABCD 内接圆 O、AB 直径、OD∥BC、CD 与 BA 延长线交于 P。
    // C 是前提点（given，在圆上）→ 用垂足对称法构造，与圆求交等价但不依赖 Intersect 索引。
    // P 是派生点（derived）→ 从前提 C、D 导出（Intersect(l_BA, l_CD)），不可反过来定义 C。
    const CIRCLE_INSCRIBED_QUAD_GOLDEN = [
        'setAxisSteps(1, 1, 1, 1)',
        'setAxisLabels(1, "x", "y", "")',
        'setCoordSystem(-6, 6, -6, 6)',
        'setAxesVisible(true, true)',
        'setGridVisible(true)',
        'O = (0, 0)',
        'c = Circle(O, 2)',
        'A = Point(c)',
        'setCoords("A", -2, 0)',
        'B = Reflect(A, O)',
        'D = Point(c)',
        'setCoords("D", -1.5, 1.3228756555322954)',
        'l_OD = Line(O, D)',
        'l_BC = Line(B, l_OD)',
        'perp = PerpendicularLine(O, l_BC)',
        'foot = Intersect(l_BC, perp)',
        'C = Reflect(B, foot)',
        'l_BA = Line(B, A)',
        'l_CD = Line(C, D)',
        'P = Intersect(l_BA, l_CD)',
        'quadABCD = Polygon(A, B, C, D)',
        'seg_OD = Segment(O, D)',
        'setColor("c", 100, 100, 100)',
        'setLineThickness("c", 2)',
        'setColor("quadABCD", 240, 140, 30)',
        'setFilling("quadABCD", 0.25)',
        'setColor("l_OD", 40, 160, 220)',
        'setLineStyle("l_OD", 1)',
        'setColor("l_BC", 40, 160, 220)',
        'setLineStyle("l_BC", 1)',
        'setColor("seg_OD", 180, 50, 50)',
        'setPointSize("O", 4)',
        'setPointSize("A", 5)',
        'setPointSize("B", 5)',
        'setPointSize("C", 5)',
        'setPointSize("D", 5)',
        'setPointSize("P", 5)',
        'setColor("O", 0, 0, 0)',
        'setColor("A", 200, 30, 30)',
        'setColor("B", 200, 30, 30)',
        'setColor("C", 30, 120, 30)',
        'setColor("D", 30, 120, 30)',
        'setColor("P", 150, 30, 150)',
        'setLabelVisible("O", true)',
        'setLabelVisible("A", true)',
        'setLabelVisible("B", true)',
        'setLabelVisible("C", true)',
        'setLabelVisible("D", true)',
        'setLabelVisible("P", true)',
    ];

    describe('Golden master: 圆内接四边形 + 延长线交点（垂足对称法构造 C）', () => {
        it('对正确的内接四边形构造应是 no-op（不丢/不改任何命令）', () => {
            const result = normalizeGeogebraCommands(CIRCLE_INSCRIBED_QUAD_GOLDEN);
            for (const cmd of CIRCLE_INSCRIBED_QUAD_GOLDEN) {
                expect(result).toContain(cmd);
            }
        });

        it('幂等：跑两次结果相同', () => {
            const once = normalizeGeogebraCommands(CIRCLE_INSCRIBED_QUAD_GOLDEN);
            const twice = normalizeGeogebraCommands(once);
            expect(twice).toEqual(once);
        });

        it('C 由垂足对称法构造（Reflect(B, foot)），不是两线 Intersect', () => {
            const result = normalizeGeogebraCommands(CIRCLE_INSCRIBED_QUAD_GOLDEN);
            // C = Reflect(B, foot)：垂足对称法，C 在圆上 + 不依赖交点索引
            expect(result.some(c => /^C\s*=\s*Reflect\s*\(\s*B/i.test(c.trim()))).toBe(true);
            // C 不应是两线 Intersect（Intersect(l_, l_) 会让 C 脱离圆周——本次 bug 根因）
            expect(result.some(c => /^C\s*=\s*Intersect\s*\(\s*l_/i.test(c.trim()))).toBe(false);
        });

        it('无 Vector 命令（半径/线段用 Segment，OA 不带箭头）', () => {
            const result = normalizeGeogebraCommands(CIRCLE_INSCRIBED_QUAD_GOLDEN);
            expect(result.some(c => /Vector\s*\(/i.test(c))).toBe(false);
        });

        it('P 命令在 C 之后（拓扑序：C 前提先于 P 派生）', () => {
            const result = normalizeGeogebraCommands(CIRCLE_INSCRIBED_QUAD_GOLDEN);
            const cIdx = result.findIndex(c => /^C\s*=\s*Reflect\s*\(\s*B/i.test(c.trim()));
            const pIdx = result.findIndex(c => /^P\s*=\s*Intersect/i.test(c.trim()));
            expect(cIdx).toBeGreaterThanOrEqual(0);
            expect(pIdx).toBeGreaterThan(cIdx);
        });

        it('反向依赖负例：C 的构造命令文本不含 P（无 C←P 循环论证）', () => {
            const result = normalizeGeogebraCommands(CIRCLE_INSCRIBED_QUAD_GOLDEN);
            // 找到 C 的定义命令，断言其文本里不出现 P（C 不可依赖派生点 P）
            const cCmd = result.find(c => /^C\s*=\s*Reflect\s*\(\s*B/i.test(c.trim()));
            expect(cCmd).toBeDefined();
            expect(cCmd).not.toMatch(/\bP\b/);
        });

        it('依赖图语义：无 DERIVED→GIVEN 反向边（P 依赖 C，C 不依赖 P）', () => {
            // 从 commands 解析点定义的依赖关系，构建依赖图，断言无反向边。
            // 纯函数测试，不依赖真实 AI 输出——锁定"信息单向流"不变量。
            const result = normalizeGeogebraCommands(CIRCLE_INSCRIBED_QUAD_GOLDEN);
            // 解析每个对象定义：形如 X = Func(args) 或 X = (x, y)
            // 提取 X 依赖的对象名（args 里出现的已定义名）
            const pointDefs = new Map<string, string[]>(); // name -> 依赖名列表
            const nameRe = /^[A-Za-z_][\w']*\s*=/;
            for (const cmd of result) {
                const trimmed = cmd.trim();
                const m = trimmed.match(/^([A-Za-z_][\w']*)\s*=\s*(.+)$/);
                if (!m) continue;
                const defName = m[1];
                const rhs = m[2];
                // 跳过纯坐标元组（自由点无依赖）和 setAxisSteps 等非对象定义
                if (/^\(\s*-?\d/.test(rhs)) continue;
                // 从 rhs 提取所有标识符（候选依赖名）
                const ids = rhs.match(/[A-Za-z_][\w']*/g) || [];
                // 过滤掉函数名（Reflect/Intersect/Line/Point/Circle/Segment/Polygon/PerpendicularLine 等）
                const funcNames = new Set([
                    'Reflect', 'Intersect', 'Line', 'Point', 'PointIn', 'PointOn',
                    'Circle', 'Segment', 'Polygon', 'PerpendicularLine', 'Midpoint',
                    'Rotate', 'Translate', 'Dilate', 'Centroid', 'ClosestPoint', 'Foot',
                    'Ellipse', 'Angle', 'Text', 'Slider', 'Locus',
                ]);
                const deps = ids.filter(id => id !== defName && !funcNames.has(id));
                pointDefs.set(defName, deps);
            }
            // 断言：C 的依赖闭包不含 P（C 不依赖 P，无反向边）
            const closure = (name: string, seen = new Set<string>()): Set<string> => {
                if (seen.has(name)) return seen;
                seen.add(name);
                const deps = pointDefs.get(name) || [];
                for (const d of deps) closure(d, seen);
                return seen;
            };
            const cClosure = closure('C');
            expect(cClosure.has('P')).toBe(false);
            // P 的依赖闭包应含 C（正向：P 依赖 C）
            const pClosure = closure('P');
            expect(pClosure.has('C')).toBe(true);
        });
    });

    // 普通线段用 Segment 不用 Vector（OA 箭头 bug 的正确构造）
    const NO_VECTOR_FOR_SEGMENT_GOLDEN = [
        'setAxisSteps(1, 1, 1, 1)',
        'setAxisLabels(1, "x", "y", "")',
        'setCoordSystem(-6, 6, -6, 6)',
        'setAxesVisible(true, true)',
        'setGridVisible(true)',
        'O = (0, 0)',
        'A = (3, 0)',
        'segOA = Segment(O, A)',
        'setColor("segOA", 180, 50, 50)',
        'setLineThickness("segOA", 3)',
        'setLabelVisible("O", true)',
        'setLabelVisible("A", true)',
    ];

    describe('Golden master: 普通线段用 Segment 不用 Vector（OA 无箭头）', () => {
        it('对正确的线段构造应是 no-op', () => {
            const result = normalizeGeogebraCommands(NO_VECTOR_FOR_SEGMENT_GOLDEN);
            for (const cmd of NO_VECTOR_FOR_SEGMENT_GOLDEN) {
                expect(result).toContain(cmd);
            }
        });

        it('幂等', () => {
            const once = normalizeGeogebraCommands(NO_VECTOR_FOR_SEGMENT_GOLDEN);
            const twice = normalizeGeogebraCommands(once);
            expect(twice).toEqual(once);
        });

        it('无 Vector 命令（半径/线段用 Segment，不带箭头）', () => {
            const result = normalizeGeogebraCommands(NO_VECTOR_FOR_SEGMENT_GOLDEN);
            expect(result.some(c => /Vector\s*\(/i.test(c))).toBe(false);
            expect(result).toContain('segOA = Segment(O, A)');
        });
    });

    // 点在线段上（2026-08-11 P/Q/J 写死坐标脱离线段 bug 回归）
    // 根因：AI 把"P 是线段 AF 上一点"生成成写死坐标自由点 P=(x,y)，坐标凑近 AF
    // 但无路径约束，拖动即脱离线段——与"把 A 写死坐标假装在圆上"同源。
    // 正确构造：先建线段 segAF=Segment(A,F)，P=Point(segAF) 路径约束 + setCoords
    // 固定初始位置（点仍约束在线段上、可沿线拖动不脱离）。
    // 本 golden 锁定该正确构造是 no-op + 幂等，并断言 P 不是自由点坐标。
    const POINT_ON_SEGMENT_GOLDEN = [
        'setAxisSteps(1, 1, 1, 1)',
        'setAxisLabels(1, "x", "y", "")',
        'setCoordSystem(-2, 2, -2, 2)',
        'setAxesVisible(true, true)',
        'setGridVisible(true)',
        'E = (0, 0)',
        'A = (1 - sqrt(3), 0)',
        'F = (1 - sqrt(3), -1)',
        'segAF = Segment(A, F)',
        'P = Point(segAF)',
        'setCoords("P", 1 - sqrt(3), -1 + sqrt(3)/2)',
        'setColor("segAF", 100, 100, 100)',
        'setLineStyle("segAF", 1)',
        'setPointSize("P", 5)',
        'setLabelVisible("E", true)',
        'setLabelVisible("A", true)',
        'setLabelVisible("F", true)',
        'setLabelVisible("P", true)',
    ];

    describe('Golden master: 点在线段上（P=Point(segAF) 不写死坐标）', () => {
        it('对正确的"点在线段上"构造应是 no-op（不丢/不改任何命令）', () => {
            const result = normalizeGeogebraCommands(POINT_ON_SEGMENT_GOLDEN);
            for (const cmd of POINT_ON_SEGMENT_GOLDEN) {
                expect(result).toContain(cmd);
            }
        });

        it('幂等：跑两次结果相同', () => {
            const once = normalizeGeogebraCommands(POINT_ON_SEGMENT_GOLDEN);
            const twice = normalizeGeogebraCommands(once);
            expect(twice).toEqual(once);
        });

        it('P 由 Point(segAF) 路径约束创建，不是写死坐标自由点', () => {
            const result = normalizeGeogebraCommands(POINT_ON_SEGMENT_GOLDEN);
            // P = Point(segAF)：路径约束在线段上，可沿线拖动不脱离
            expect(result.some(c => /^P\s*=\s*Point\s*\(\s*segAF\s*\)/i.test(c.trim()))).toBe(true);
            // P 不应是写死坐标自由点（P = (x, y) 会让 P 脱离线段——本次 bug 根因）
            expect(result.some(c => /^P\s*=\s*\(\s*-?\d/.test(c.trim()))).toBe(false);
        });

        it('线段 segAF 在 P 之前创建（拓扑序：被依赖对象先于引用对象）', () => {
            const result = normalizeGeogebraCommands(POINT_ON_SEGMENT_GOLDEN);
            const segIdx = result.findIndex(c => /^segAF\s*=\s*Segment/i.test(c.trim()));
            const pIdx = result.findIndex(c => /^P\s*=\s*Point\s*\(\s*segAF/i.test(c.trim()));
            expect(segIdx).toBeGreaterThanOrEqual(0);
            expect(pIdx).toBeGreaterThan(segIdx);
        });

        it('P 的 setCoords 在 P 创建之后（先约束到路径再固定初始位置）', () => {
            const result = normalizeGeogebraCommands(POINT_ON_SEGMENT_GOLDEN);
            const pCreateIdx = result.findIndex(c => /^P\s*=\s*Point\s*\(\s*segAF/i.test(c.trim()));
            const pCoordsIdx = result.findIndex(c => /setCoords\s*\(\s*["']P["']\s*,/i.test(c.trim()));
            expect(pCreateIdx).toBeGreaterThanOrEqual(0);
            expect(pCoordsIdx).toBeGreaterThan(pCreateIdx);
        });
    });

    // 平行四边形 + 高（2026-08-11 ABCD 全自由点 + AF/CE 非高 bug 回归）
    // 根因：AI 把"ABCD 是平行四边形"生成成 4 个写死坐标自由点 + Polygon 壳，
    // 把"AF/CE 是高"生成成写死坐标凑视觉垂足——拖动即破坏平行/垂直关系。
    // 正确构造：3 自由顶点 + 1 Translate 派生第 4 顶点（保持平行四边形），
    // F/E 用 Intersect(PerpendicularLine(...), 边) 真垂足（保持垂直）。
    // 本 golden 锁定该正确构造是 no-op + 幂等，并断言无"全自由点/假垂足"反例。
    const PARALLELOGRAM_WITH_ALTITUDE_GOLDEN = [
        'setAxisSteps(1, 1, 1, 1)',
        'setAxisLabels(1, "x", "y", "")',
        'setCoordSystem(-1, 3, -1.5, 2.5)',
        'setAxesVisible(true, true)',
        'setGridVisible(true)',
        'A = (0, 1)',
        'B = (1, 1)',
        'D = (0, 0)',
        'C = Translate(B, Vector(A, D))',
        'l_CD = Line(C, D)',
        'l_AB = Line(A, B)',
        'F = Intersect(PerpendicularLine(A, l_CD), l_CD)',
        'E = Intersect(PerpendicularLine(C, l_AB), l_AB)',
        'polyABCD = Polygon(A, B, C, D)',
        'segAF = Segment(A, F)',
        'segCE = Segment(C, E)',
        'setColor("polyABCD", 200, 200, 200)',
        'setFilling("polyABCD", 0.15)',
        'setColor("segAF", 100, 100, 100)',
        'setLineStyle("segAF", 1)',
        'setColor("segCE", 100, 100, 100)',
        'setLineStyle("segCE", 1)',
        'setLabelVisible("A", true)',
        'setLabelVisible("B", true)',
        'setLabelVisible("C", true)',
        'setLabelVisible("D", true)',
        'setLabelVisible("F", true)',
        'setLabelVisible("E", true)',
    ];

    describe('Golden master: 平行四边形 + 高（C=Translate 派生, F/E 真垂足）', () => {
        it('对正确的平行四边形+高构造应是 no-op（不丢/不改任何命令）', () => {
            const result = normalizeGeogebraCommands(PARALLELOGRAM_WITH_ALTITUDE_GOLDEN);
            for (const cmd of PARALLELOGRAM_WITH_ALTITUDE_GOLDEN) {
                expect(result).toContain(cmd);
            }
        });

        it('幂等：跑两次结果相同', () => {
            const once = normalizeGeogebraCommands(PARALLELOGRAM_WITH_ALTITUDE_GOLDEN);
            const twice = normalizeGeogebraCommands(once);
            expect(twice).toEqual(once);
        });

        it('第 4 顶点 C 由 Translate(B, Vector(A, D)) 派生，不是写死坐标自由点', () => {
            const result = normalizeGeogebraCommands(PARALLELOGRAM_WITH_ALTITUDE_GOLDEN);
            // C = Translate(B, Vector(A, D))：约束派生，拖 A/B/D 则 C 跟随保持平行四边形
            expect(result.some(c => /^C\s*=\s*Translate\s*\(\s*B\s*,\s*Vector\s*\(\s*A\s*,\s*D\s*\)/i.test(c.trim()))).toBe(true);
            // C 不应是写死坐标自由点（C = (x, y) 会让 ABCD 变任意四边形——本次 bug 根因）
            expect(result.some(c => /^C\s*=\s*\(\s*-?\d/.test(c.trim()))).toBe(false);
        });

        it('4 顶点不全自由：A/B/D 自由 + C 派生（不可 4 个全写死坐标）', () => {
            const result = normalizeGeogebraCommands(PARALLELOGRAM_WITH_ALTITUDE_GOLDEN);
            // 自由顶点 A/B/D 是坐标元组，C 是 Translate 派生——3 自由 + 1 派生
            const freeVerts = ['A', 'B', 'D'].filter(v =>
                result.some(c => new RegExp(`^${v}\\s*=\\s*\\(\\s*-?\\d`).test(c.trim()))
            );
            expect(freeVerts.length).toBe(3);
            // C 必须是派生（Translate），不是第 4 个自由点
            const cIsFree = result.some(c => /^C\s*=\s*\(\s*-?\d/.test(c.trim()));
            expect(cIsFree).toBe(false);
        });

        it('垂足 F 由 Intersect(PerpendicularLine(A, l_CD), l_CD) 构造，不是写死坐标', () => {
            const result = normalizeGeogebraCommands(PARALLELOGRAM_WITH_ALTITUDE_GOLDEN);
            // F = Intersect(PerpendicularLine(A, l_CD), l_CD)：真垂足，AF⊥CD
            expect(result.some(c => /^F\s*=\s*Intersect\s*\(\s*PerpendicularLine\s*\(\s*A\s*,\s*l_CD/i.test(c.trim()))).toBe(true);
            // F 不应是写死坐标自由点（F = (x, y) 是视觉垂足，拖动后 AF 不再垂直 CD——本次 bug 根因）
            expect(result.some(c => /^F\s*=\s*\(\s*-?\d/.test(c.trim()))).toBe(false);
        });

        it('拓扑序：A/B/D 自由点先于 C 派生；l_CD 先于 F 垂足', () => {
            const result = normalizeGeogebraCommands(PARALLELOGRAM_WITH_ALTITUDE_GOLDEN);
            const dIdx = result.findIndex(c => /^D\s*=\s*\(/.test(c.trim()));
            const cIdx = result.findIndex(c => /^C\s*=\s*Translate/i.test(c.trim()));
            const lcdIdx = result.findIndex(c => /^l_CD\s*=\s*Line/i.test(c.trim()));
            const fIdx = result.findIndex(c => /^F\s*=\s*Intersect/i.test(c.trim()));
            expect(dIdx).toBeGreaterThanOrEqual(0);
            expect(cIdx).toBeGreaterThan(dIdx);   // C 派生在 D 自由之后
            expect(lcdIdx).toBeGreaterThanOrEqual(0);
            expect(fIdx).toBeGreaterThan(lcdIdx); // F 垂足在 l_CD 之后
        });
    });

    // 等边三角形（2026-08-11 专家建议：Polygon(A,B,3) 优先于 Rotate+Polygon）
    // 根因预防：AI 可能拆成 C=Rotate(B,60°,A)+Polygon(A,B,C)，多一条构造链且
    // ±60° 方向易选错；或写死 C 坐标凑等边，拖动即破坏。Polygon(A,B,3) 是
    // GeoGebra 原生正多边形构造，第三顶点自动派生、三边等长，最干净。
    // 注意：Polygon(A,B,3) 的第三顶点由 GeoGebra 自动命名为 C，golden 里显式
    // 写 setLabelVisible("C")；normalizer 的 POINT_FUNC_RE 不含 Polygon，
    // 不会自动检测 C，故不会重复追加——golden 已覆盖即 no-op。
    const EQUILATERAL_TRIANGLE_GOLDEN = [
        'setAxisSteps(1, 1, 1, 1)',
        'setAxisLabels(1, "x", "y", "")',
        'setCoordSystem(-1, 3, -1, 3)',
        'setAxesVisible(true, true)',
        'setGridVisible(true)',
        'A = (0, 0)',
        'B = (2, 0)',
        't1 = Polygon(A, B, 3)',
        'setColor("t1", 100, 149, 237)',
        'setFilling("t1", 0.15)',
        'setPointSize("A", 5)',
        'setPointSize("B", 5)',
        'setLabelVisible("A", true)',
        'setLabelVisible("B", true)',
        'setLabelVisible("C", true)',
    ];

    describe('Golden master: 等边三角形（Polygon(A,B,3) 不拆 Rotate）', () => {
        it('对正确的等边三角形构造应是 no-op（不丢/不改任何命令）', () => {
            const result = normalizeGeogebraCommands(EQUILATERAL_TRIANGLE_GOLDEN);
            for (const cmd of EQUILATERAL_TRIANGLE_GOLDEN) {
                expect(result).toContain(cmd);
            }
        });

        it('幂等：跑两次结果相同', () => {
            const once = normalizeGeogebraCommands(EQUILATERAL_TRIANGLE_GOLDEN);
            const twice = normalizeGeogebraCommands(once);
            expect(twice).toEqual(once);
        });

        it('用 Polygon(A, B, 3) 正多边形构造，不拆 Rotate+Polygon', () => {
            const result = normalizeGeogebraCommands(EQUILATERAL_TRIANGLE_GOLDEN);
            // Polygon(A, B, 3)：原生正多边形构造，第三顶点自动派生
            expect(result.some(c => /Polygon\s*\(\s*A\s*,\s*B\s*,\s*3\s*\)/i.test(c.trim()))).toBe(true);
            // 不应出现 Rotate 拆解（C = Rotate(B, 60°, A) 多一条构造链 + 方向易错）
            expect(result.some(c => /Rotate\s*\(/i.test(c.trim()))).toBe(false);
        });

        it('无写死的第三点 C = (x, y) 自由点（第三顶点由 Polygon 自动派生）', () => {
            const result = normalizeGeogebraCommands(EQUILATERAL_TRIANGLE_GOLDEN);
            // C 不应是写死坐标自由点（C = (x, y) 拖动即破坏等边——本次要预防的 bug）
            expect(result.some(c => /^C\s*=\s*\(\s*-?\d/.test(c.trim()))).toBe(false);
        });
    });

    // 等腰三角形（2026-08-11 专家建议：按题意选构造，C 用中垂线派生）
    // 根因预防：AI 可能把"以 AB 为底作等腰三角形 AC=BC"生成成写死 C 坐标凑视觉等腰，
    // 拖动即破坏。正确：C=Point(PerpendicularBisector(A,B))，C 在中垂线上天然 AC=BC。
    // Polygon(A,B,C) 只连线，等腰约束来自 C 在中垂线上（Polygon 不是约束命令）。
    const ISOSCELES_TRIANGLE_GOLDEN = [
        'setAxisSteps(1, 1, 1, 1)',
        'setAxisLabels(1, "x", "y", "")',
        'setCoordSystem(-1, 3, -1, 3)',
        'setAxesVisible(true, true)',
        'setGridVisible(true)',
        'A = (0, 0)',
        'B = (2, 0)',
        'l = PerpendicularBisector(A, B)',
        'C = Point(l)',
        'setCoords("C", 1, 1.5)',
        't1 = Polygon(A, B, C)',
        'setColor("l", 150, 150, 150)',
        'setLineStyle("l", 1)',
        'setColor("t1", 255, 127, 80)',
        'setFilling("t1", 0.15)',
        'setPointSize("A", 5)',
        'setPointSize("B", 5)',
        'setPointSize("C", 5)',
        'setLabelVisible("A", true)',
        'setLabelVisible("B", true)',
        'setLabelVisible("C", true)',
    ];

    describe('Golden master: 等腰三角形（C=Point(中垂线) 不写死坐标）', () => {
        it('对正确的等腰三角形构造应是 no-op（不丢/不改任何命令）', () => {
            const result = normalizeGeogebraCommands(ISOSCELES_TRIANGLE_GOLDEN);
            for (const cmd of ISOSCELES_TRIANGLE_GOLDEN) {
                expect(result).toContain(cmd);
            }
        });

        it('幂等：跑两次结果相同', () => {
            const once = normalizeGeogebraCommands(ISOSCELES_TRIANGLE_GOLDEN);
            const twice = normalizeGeogebraCommands(once);
            expect(twice).toEqual(once);
        });

        it('C 由 Point(l) 路径约束创建（l 是 AB 中垂线），不是写死坐标自由点', () => {
            const result = normalizeGeogebraCommands(ISOSCELES_TRIANGLE_GOLDEN);
            // C = Point(l)：路径约束在中垂线上，天然 AC=BC
            expect(result.some(c => /^C\s*=\s*Point\s*\(\s*l\s*\)/i.test(c.trim()))).toBe(true);
            // C 不应是写死坐标自由点（C = (x, y) 拖动即脱离中垂线、破坏等腰——本次要预防的 bug）
            expect(result.some(c => /^C\s*=\s*\(\s*-?\d/.test(c.trim()))).toBe(false);
        });

        it('中垂线 l 在 C 之前创建（拓扑序：被依赖对象先于引用对象）', () => {
            const result = normalizeGeogebraCommands(ISOSCELES_TRIANGLE_GOLDEN);
            const lIdx = result.findIndex(c => /^l\s*=\s*PerpendicularBisector/i.test(c.trim()));
            const cIdx = result.findIndex(c => /^C\s*=\s*Point\s*\(\s*l/i.test(c.trim()));
            expect(lIdx).toBeGreaterThanOrEqual(0);
            expect(cIdx).toBeGreaterThan(lIdx);
        });

        it('C 的 setCoords 在 C 创建之后（先约束到中垂线再固定初始位置）', () => {
            const result = normalizeGeogebraCommands(ISOSCELES_TRIANGLE_GOLDEN);
            const cCreateIdx = result.findIndex(c => /^C\s*=\s*Point\s*\(\s*l/i.test(c.trim()));
            const cCoordsIdx = result.findIndex(c => /setCoords\s*\(\s*["']C["']\s*,/i.test(c.trim()));
            expect(cCreateIdx).toBeGreaterThanOrEqual(0);
            expect(cCoordsIdx).toBeGreaterThan(cCreateIdx);
        });
    });

    // ── 第三轮回归（2026-08-13 Round/Intersect花括号/Polygon静默失败）────────
    // 根因见记忆 geogebra-command-facts-verified：
    // 1. Round 不可用（applet 5.4.920.0 不认，官网只有 Numeric 语义≠小数位）
    // 2. Intersect 多交点赋列表须花括号 {Intersect(...)}，否则非列表、Element 失败
    // 3. Polygon 点列表形式确定性静默失败（t1 不进 allNames），追加 Segment 兜底画边
    // 最小实验（手改 DB 43 条）已验证 0 失败，本组锁定后处理器确定性兜底。

    describe('Round 去除（Text 命令内）', () => {
        it('Text 内 Round(X, 2) 改写为 X（去外壳留 expr）', () => {
            const cmds = [
                'setCoordSystem(-6, 6, -6, 6)',
                'txt1 = Text("DA = " + Round(Distance(D, A), 2), (-3.5, -1))',
            ];
            const result = normalizeGeogebraCommands(cmds);
            expect(result).toContain('txt1 = Text("DA = " + Distance(D, A), (-3.5, -1))');
            expect(result.some(c => /Round\s*\(/i.test(c))).toBe(false);
        });

        it('含嵌套括号的 Round expr 正确去除（Round(Distance(D,A)+Distance(D,C), 2)）', () => {
            const cmds = [
                'setCoordSystem(-6, 6, -6, 6)',
                'txt = Text("sum = " + Round(Distance(D, A) + Distance(D, C), 2), (1, 2))',
            ];
            const result = normalizeGeogebraCommands(cmds);
            expect(result).toContain('txt = Text("sum = " + Distance(D, A) + Distance(D, C), (1, 2))');
        });

        it('一个 Text 含多个 Round 全部去除', () => {
            const cmds = [
                'setCoordSystem(-6, 6, -6, 6)',
                't = Text("a=" + Round(x, 2) + " b=" + Round(y, 2), (1, 1))',
            ];
            const result = normalizeGeogebraCommands(cmds);
            expect(result).toContain('t = Text("a=" + x + " b=" + y, (1, 1))');
        });

        it('无 Round 的 Text 原样保留（非破坏）', () => {
            const cmds = [
                'setCoordSystem(-6, 6, -6, 6)',
                'txt = Text("DA = " + Distance(D, A), (-3.5, -1))',
            ];
            const result = normalizeGeogebraCommands(cmds);
            expect(result).toContain('txt = Text("DA = " + Distance(D, A), (-3.5, -1))');
        });

        it('非 Text 命令的 Round 赋值不动（独立 Round 不在本轮范围）', () => {
            const cmds = [
                'setCoordSystem(-6, 6, -6, 6)',
                'k = Round(3.14159, 2)',
            ];
            const result = normalizeGeogebraCommands(cmds);
            // 独立 Round 赋值不改写（让 evalCommand 报错计入 fail，不影响 Text 路径）
            expect(result).toContain('k = Round(3.14159, 2)');
        });

        it('幂等：跑两次结果相同', () => {
            const cmds = [
                'setCoordSystem(-6, 6, -6, 6)',
                'txt1 = Text("DA = " + Round(Distance(D, A), 2), (-3.5, -1))',
            ];
            const once = normalizeGeogebraCommands(cmds);
            const twice = normalizeGeogebraCommands(once);
            expect(twice).toEqual(once);
        });
    });

    describe('Intersect 多交点列表加花括号', () => {
        it('listE = Intersect(cD, segDB) → listE = {Intersect(cD, segDB)}', () => {
            const cmds = [
                'setCoordSystem(-6, 6, -6, 6)',
                'listE = Intersect(cD, segDB)',
            ];
            const result = normalizeGeogebraCommands(cmds);
            expect(result).toContain('listE = {Intersect(cD, segDB)}');
            expect(result).not.toContain('listE = Intersect(cD, segDB)');
        });

        it('已包花括号的跳过（幂等）', () => {
            const cmds = [
                'setCoordSystem(-6, 6, -6, 6)',
                'listD = {Intersect(cA, cC)}',
            ];
            const result = normalizeGeogebraCommands(cmds);
            expect(result).toContain('listD = {Intersect(cA, cC)}');
            // 不应变成双花括号
            expect(result.some(c => /\{\{Intersect/i.test(c))).toBe(false);
        });

        it('P = Intersect(f, g) 两线单点不加花括号（list 前缀守卫）', () => {
            const cmds = [
                'setCoordSystem(-6, 6, -6, 6)',
                'f = x^2',
                'g = 2*x',
                'P = Intersect(f, g)',
            ];
            const result = normalizeGeogebraCommands(cmds);
            expect(result).toContain('P = Intersect(f, g)');
            // P 不是 list 前缀，不应加花括号（会变成长度1列表破坏点引用）
            expect(result.some(c => /P\s*=\s*\{Intersect/i.test(c))).toBe(false);
        });

        it('幂等：跑两次结果相同', () => {
            const cmds = [
                'setCoordSystem(-6, 6, -6, 6)',
                'listE = Intersect(cD, segDB)',
            ];
            const once = normalizeGeogebraCommands(cmds);
            const twice = normalizeGeogebraCommands(once);
            expect(twice).toEqual(once);
        });
    });

    describe('Polygon 点列表形式追加 Segment 兜底边', () => {
        it('t1 = Polygon(A, B, C) 紧后插 segAB/segBC/segCA 三条闭合边', () => {
            const cmds = [
                'setCoordSystem(-6, 6, -6, 6)',
                'A = (0, 0)',
                'B = (2, 0)',
                'C = (1, 2)',
                't1 = Polygon(A, B, C)',
            ];
            const result = normalizeGeogebraCommands(cmds);
            expect(result).toContain('t1 = Polygon(A, B, C)'); // 原命令保留
            expect(result).toContain('segAB = Segment(A, B)');
            expect(result).toContain('segBC = Segment(B, C)');
            expect(result).toContain('segCA = Segment(C, A)'); // 闭合边
            // Segment 紧跟在 Polygon 之后（拓扑序）
            const polyIdx = result.indexOf('t1 = Polygon(A, B, C)');
            const segABIdx = result.indexOf('segAB = Segment(A, B)');
            expect(segABIdx).toBe(polyIdx + 1);
        });

        it('Polygon(A, B, 3) n-gon 不插 Segment（末参数字守卫）', () => {
            const cmds = [
                'setCoordSystem(-6, 6, -6, 6)',
                'A = (0, 0)',
                'B = (2, 0)',
                't1 = Polygon(A, B, 3)',
            ];
            const result = normalizeGeogebraCommands(cmds);
            // n-gon 顶点自动派生命名，不应加 Segment（会引用未定义点）
            expect(result.some(c => /^seg\w*\s*=\s*Segment/i.test(c.trim()))).toBe(false);
        });

        it('四边形 Polygon(A,B,C,D) 插 4 条闭合边（含末→首 DA）', () => {
            const cmds = [
                'setCoordSystem(-6, 6, -6, 6)',
                'A = (0, 0)', 'B = (2, 0)', 'C = (2, 2)', 'D = (0, 2)',
                'quad = Polygon(A, B, C, D)',
            ];
            const result = normalizeGeogebraCommands(cmds);
            expect(result).toContain('segAB = Segment(A, B)');
            expect(result).toContain('segBC = Segment(B, C)');
            expect(result).toContain('segCD = Segment(C, D)');
            expect(result).toContain('segDA = Segment(D, A)'); // 闭合边
        });

        it('撇号顶点 Polygon(A\', B\', C\') 兜底边对象名撇号转下划线', () => {
            const cmds = [
                'setCoordSystem(-6, 6, -6, 6)',
                "A' = (1, -1)",
                "B' = (2, 0)",
                "C' = (2, 2)",
                "t2 = Polygon(A', B', C')",
            ];
            const result = normalizeGeogebraCommands(cmds);
            // 对象名撇号→下划线，参数仍用原撇号点名
            expect(result).toContain("segA_B_ = Segment(A', B')");
            expect(result).toContain("segB_C_ = Segment(B', C')");
            expect(result).toContain("segC_A_ = Segment(C', A')");
        });

        it('AI 已显式画某边时不重复（幂等去重）', () => {
            const cmds = [
                'setCoordSystem(-6, 6, -6, 6)',
                'A = (0, 0)', 'B = (2, 0)', 'C = (1, 2)',
                't1 = Polygon(A, B, C)',
                'segAB = Segment(A, B)', // AI 已画 AB
            ];
            const result = normalizeGeogebraCommands(cmds);
            // segAB 只出现一次（AI 的），segBC/segCA 被补
            const segABCount = result.filter(c => /^segAB\s*=/.test(c.trim())).length;
            expect(segABCount).toBe(1);
            expect(result).toContain('segBC = Segment(B, C)');
            expect(result).toContain('segCA = Segment(C, A)');
        });

        it('幂等：跑两次结果相同（不重复追加 Segment）', () => {
            const cmds = [
                'setCoordSystem(-6, 6, -6, 6)',
                'A = (0, 0)', 'B = (2, 0)', 'C = (1, 2)',
                't1 = Polygon(A, B, C)',
            ];
            const once = normalizeGeogebraCommands(cmds);
            const twice = normalizeGeogebraCommands(once);
            expect(twice).toEqual(once);
            // 第二次不应多出额外 Segment
            const segCount = twice.filter(c => /^seg\w+\s*=\s*Segment/i.test(c.trim())).length;
            expect(segCount).toBe(3);
        });
    });

    describe('Golden master 不破坏（追加兜底 Segment 不丢原命令）', () => {
        it('GOLDEN_MASTER 含 t1=Polygon(A,B,C) + t2=Polygon(A\',B\',C\')：原 46 条全在 + 各加 3 条兜底', () => {
            const result = normalizeGeogebraCommands(GOLDEN_MASTER);
            // 每条原命令都还在（非破坏：只追加，不丢/不改）
            for (const cmd of GOLDEN_MASTER) {
                expect(result).toContain(cmd);
            }
            // t1 兜底 3 条 + t2 兜底 3 条 = 6 条新 Segment
            expect(result).toContain('segAB = Segment(A, B)');
            expect(result).toContain('segBC = Segment(B, C)');
            expect(result).toContain('segCA = Segment(C, A)');
            expect(result).toContain("segA_B_ = Segment(A', B')");
            expect(result).toContain("segB_C_ = Segment(B', C')");
            expect(result).toContain("segC_A_ = Segment(C', A')");
            // 不应新增 setLabelVisible（golden 已覆盖所有点）
            const labelCount = result.filter(c => /^setLabelVisible/i.test(c.trim())).length;
            const goldenLabelCount = GOLDEN_MASTER.filter(c => /^setLabelVisible/i.test(c.trim())).length;
            expect(labelCount).toBe(goldenLabelCount);
        });
    });
});

describe('parseGeogebraResponse', () => {
    it('解析带 markdown 代码块的 JSON 并 normalize', () => {
        const raw = '```json\n{"suitable": true, "commands": ["A = (1, 2)"], "description": "测试"}\n```';
        const result = parseGeogebraResponse(raw);
        expect(result.suitable).toBe(true);
        expect(result.description).toBe('测试');
        // 应被 normalize：补 setAxisSteps/setAxisLabels + setLabelVisible("A")
        expect(result.commands).toContain('setAxisSteps(1, 1, 1, 1)');
        expect(result.commands).toContain('setLabelVisible("A", true)');
    });

    it('suitable: false 时不 normalize（原样返回空 commands）', () => {
        const raw = '{"suitable": false, "commands": [], "description": "不适合"}';
        const result = parseGeogebraResponse(raw);
        expect(result.suitable).toBe(false);
        expect(result.commands).toEqual([]);
        // 不应凭空加 view-setup
        expect(result.commands).not.toContain('setAxisSteps(1, 1, 1, 1)');
    });

    it('空响应抛错', () => {
        expect(() => parseGeogebraResponse('')).toThrow('Empty response');
    });

    it('响应前后有杂文字时仍能抽出 JSON 对象', () => {
        const raw = '好的，这是结果：\n{"suitable": true, "commands": ["O = (0, 0)"], "description": "原点"}\n以上。';
        const result = parseGeogebraResponse(raw);
        expect(result.suitable).toBe(true);
        expect(result.commands).toContain('setLabelVisible("O", true)');
    });

    // 两阶段输出：AI 在 JSON 里输出 dependencyAnalysis（推理脚手架），
    // parseGeogebraResponse 应丢弃该字段——只保留 suitable/commands/description。
    // dependencyAnalysis 是逼 AI 先推理约束关系的手段，不是交付物，不流到下游。
    // 第二轮（2026-08-11）：dependencyAnalysis 每项加 origin 字段（given/constructed/derived/target），
    // 同样被丢弃——origin 是 prompt-only 推理脚手架，service 层校验器留待将来。
    it('带 dependencyAnalysis+origin 字段的 JSON：commands 正常 normalize，两字段都被丢弃', () => {
        const raw = JSON.stringify({
            suitable: true,
            dependencyAnalysis: [
                { name: 'O', type: 'free', dependsOn: [], origin: 'given' },
                { name: 'c', type: 'circle', dependsOn: ['O'], origin: 'given' },
                { name: 'A', type: 'path', dependsOn: ['c'], origin: 'given' },
                { name: 'B', type: 'reflect', dependsOn: ['A', 'O'], origin: 'derived' },
                { name: 'C', type: 'path', dependsOn: ['c', 'l_BC'], origin: 'given' },
                { name: 'P', type: 'intersect', dependsOn: ['l_BA', 'l_CD'], origin: 'derived' },
            ],
            commands: [
                'setCoordSystem(-6, 6, -6, 6)',
                'O = (0, 0)',
                'c = Circle(O, 2)',
                'A = Point(c)',
                'setCoords("A", -2, 0)',
                'B = Reflect(A, O)',
                'C = Reflect(B, foot)',
                'P = Intersect(l_BA, l_CD)',
            ],
            description: '圆内接四边形 + 延长线交点演示',
        });
        const result = parseGeogebraResponse(raw);
        expect(result.suitable).toBe(true);
        expect(result.description).toBe('圆内接四边形 + 延长线交点演示');
        // commands 应被 normalize：补 view-setup + setLabelVisible
        expect(result.commands).toContain('setAxisSteps(1, 1, 1, 1)');
        expect(result.commands).toContain('setLabelVisible("A", true)');
        expect(result.commands).toContain('setLabelVisible("B", true)');
        // dependencyAnalysis 不应出现在结果对象上（被丢弃，不流到下游）
        expect((result as unknown as Record<string, unknown>).dependencyAnalysis).toBeUndefined();
        // origin 也不应出现在结果对象上（脚手架字段，不流到下游）
        expect((result as unknown as Record<string, unknown>).origin).toBeUndefined();
    });

    it('无 dependencyAnalysis 的旧格式 JSON 仍兼容（回归）', () => {
        // 旧格式只有 suitable/commands/description，AI 未输出 dependencyAnalysis
        const raw = '{"suitable": true, "commands": ["A = (1, 2)"], "description": "旧格式"}';
        const result = parseGeogebraResponse(raw);
        expect(result.suitable).toBe(true);
        expect(result.description).toBe('旧格式');
        expect(result.commands).toContain('setLabelVisible("A", true)');
        expect((result as unknown as Record<string, unknown>).dependencyAnalysis).toBeUndefined();
    });
});

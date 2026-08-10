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
});

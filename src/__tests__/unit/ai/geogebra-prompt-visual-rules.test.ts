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
            expect(DEFAULT_GEOGEBRA_PROMPT).toContain('固定顶点是否按原图方位给坐标');
            expect(DEFAULT_GEOGEBRA_PROMPT).toContain('派生顶点落点与标签是否均与原图一致');
            expect(DEFAULT_GEOGEBRA_PROMPT).toContain('标签→坐标→原图方位三者一致');
        });

        it('应区分 given 固定点与构造派生，禁止把固定三角形用 Polygon(A,B,n) 派生', () => {
            expect(DEFAULT_GEOGEBRA_PROMPT).toContain('题目前提（固定点）');
            expect(DEFAULT_GEOGEBRA_PROMPT).toContain('普通 Polygon(A, B, C) 连线');
            expect(DEFAULT_GEOGEBRA_PROMPT).toContain('严禁**用 Polygon(A, B, n) 派生');
            expect(DEFAULT_GEOGEBRA_PROMPT).not.toContain('应选 BC 为基准边');
        });

        it('应要求标签贴在原图对应方位的那个点上', () => {
            expect(DEFAULT_GEOGEBRA_PROMPT).toContain('标签必须贴在原图对应方位的那个点上');
            expect(DEFAULT_GEOGEBRA_PROMPT).toContain('A 的坐标必须是顶部那个点的坐标');
            expect(DEFAULT_GEOGEBRA_PROMPT).toContain('整体顺时针转 120°');
        });

        it('应推荐 Slider 参数化边长（B=(0,0) C=(s,0) A=(s/2, s*sqrt(3)/2)）', () => {
            expect(DEFAULT_GEOGEBRA_PROMPT).toContain('Slider 参数化');
            expect(DEFAULT_GEOGEBRA_PROMPT).toContain('s = Slider(1, 10, 0.01)');
            expect(DEFAULT_GEOGEBRA_PROMPT).toContain('B=(0,0)');
            expect(DEFAULT_GEOGEBRA_PROMPT).toContain('C=(s,0)');
            expect(DEFAULT_GEOGEBRA_PROMPT).toContain('A=(s/2, s*sqrt(3)/2)');
            expect(DEFAULT_GEOGEBRA_PROMPT).toContain('A 的 x 坐标必须居中');
            expect(DEFAULT_GEOGEBRA_PROMPT).toContain('底边 BC 水平');
            expect(DEFAULT_GEOGEBRA_PROMPT).toContain('严禁用 Rotate 派生固定顶点');
        });

        it('应要求主要几何图形边框用深色突出视觉主体', () => {
            expect(DEFAULT_GEOGEBRA_PROMPT).toContain('边框必须用深色');
            expect(DEFAULT_GEOGEBRA_PROMPT).toContain('线宽 >= 3');
        });

        it('应允许辅助线段展示几何关系，不禁止画题目未提及的线段', () => {
            expect(DEFAULT_GEOGEBRA_PROMPT).toContain('辅助线段');
            expect(DEFAULT_GEOGEBRA_PROMPT).toContain('可以帮助理解题意');
        });

        it('应要求共线关系用绿色虚线展示', () => {
            expect(DEFAULT_GEOGEBRA_PROMPT).toContain('绿色虚线连接共线点');
            expect(DEFAULT_GEOGEBRA_PROMPT).toContain('展示共线关系');
            expect(DEFAULT_GEOGEBRA_PROMPT).toContain('19. **共线关系用绿色虚线展示**');
            expect(DEFAULT_GEOGEBRA_PROMPT).toContain('共线关系是否用绿色虚线标出');
        });

        it('应包含 AE 绿色虚线展示 ADE 共线的具体示例', () => {
            expect(DEFAULT_GEOGEBRA_PROMPT).toContain('segAE = Segment(A, E)');
            expect(DEFAULT_GEOGEBRA_PROMPT).toContain('展示 A/D/E 共线关系');
        });
    });

    describe('规则 1b：golden reference 命令模式', () => {
        it('应包含 Intersect 列表 + Element(list, 索引) 取点模式', () => {
            expect(DEFAULT_GEOGEBRA_PROMPT).toContain('Element(列表, 索引)');
            expect(DEFAULT_GEOGEBRA_PROMPT).toContain('Element(list, 1)');
        });

        it('应包含 If + Length 容错处理模式', () => {
            expect(DEFAULT_GEOGEBRA_PROMPT).toContain('If(Length(');
            expect(DEFAULT_GEOGEBRA_PROMPT).toContain('(NaN, NaN)');
        });

        it('应包含 Segment 从多边形提取边的模式', () => {
            expect(DEFAULT_GEOGEBRA_PROMPT).toContain('从多边形提取边');
            expect(DEFAULT_GEOGEBRA_PROMPT).toContain('a = Segment(B, C, t1)');
        });

        it('应包含 SetConditionToShowObject + Boolean 可见性开关', () => {
            expect(DEFAULT_GEOGEBRA_PROMPT).toContain('SetConditionToShowObject');
            expect(DEFAULT_GEOGEBRA_PROMPT).toContain('Boolean(true,');
        });

        it('应包含 SetColor 十六进制重载', () => {
            expect(DEFAULT_GEOGEBRA_PROMPT).toContain('SetColor(t1, "#2E86AB")');
            expect(DEFAULT_GEOGEBRA_PROMPT).toContain('SetColor 首字母大写');
        });

        it('应说明 Rotate 用度符号非弧度', () => {
            expect(DEFAULT_GEOGEBRA_PROMPT).toContain('如 -60°');
            expect(DEFAULT_GEOGEBRA_PROMPT).toContain('不是弧度');
        });

        it('应包含 Distance / Length / Element / If / Max 命令，并说明 Round 不可用', () => {
            expect(DEFAULT_GEOGEBRA_PROMPT).toContain('Distance(A, B)');
            expect(DEFAULT_GEOGEBRA_PROMPT).toContain('Length(list)');
            expect(DEFAULT_GEOGEBRA_PROMPT).toContain('Element(list, n)');
            expect(DEFAULT_GEOGEBRA_PROMPT).toContain('Max(a, b)');
            // Round 不可用（applet 5.4.920.0 不认，见记忆 geogebra-command-facts-verified）：
            // prompt 应明确说明不支持 Round，而非教 Round(num, decimals)
            expect(DEFAULT_GEOGEBRA_PROMPT).toContain('不支持 Round');
            expect(DEFAULT_GEOGEBRA_PROMPT).not.toContain('Round(num, decimals)');
        });

        it('应强调 GeoGebra DSL 内置函数首字母大写，小写会报未知指令', () => {
            expect(DEFAULT_GEOGEBRA_PROMPT).toContain('首字母大写');
            expect(DEFAULT_GEOGEBRA_PROMPT).toContain('小写会报');
        });

        it('应包含 #20 两圆交点取点构造链规则', () => {
            expect(DEFAULT_GEOGEBRA_PROMPT).toContain('20. **两圆交点取点模式');
            expect(DEFAULT_GEOGEBRA_PROMPT).toContain('D = Element(list, 1)');
            expect(DEFAULT_GEOGEBRA_PROMPT).toContain('先建圆→求交列表→取点');
        });

        it('应包含典型构造链示例（含 D 取点 + E 旋转）', () => {
            expect(DEFAULT_GEOGEBRA_PROMPT).toContain('rA=Slider(1,6,0.01,3)');
            expect(DEFAULT_GEOGEBRA_PROMPT).toContain('rC=Slider(1,5,0.01,2)');
            expect(DEFAULT_GEOGEBRA_PROMPT).toContain('cA = Circle(A, rA)');
            expect(DEFAULT_GEOGEBRA_PROMPT).toContain('cC = Circle(C, rC)');
            expect(DEFAULT_GEOGEBRA_PROMPT).toContain('list = {Intersect(cA, cC)}');
            expect(DEFAULT_GEOGEBRA_PROMPT).toContain('E = Rotate(D, -60°, C)');
        });

        it('应要求核对原图 BC 左右顺序，不可机械套用模板', () => {
            expect(DEFAULT_GEOGEBRA_PROMPT).toContain('B 在左、C 在右');
            expect(DEFAULT_GEOGEBRA_PROMPT).toContain('务必核对原图左右顺序');
            expect(DEFAULT_GEOGEBRA_PROMPT).toContain('不可机械套用模板导致左右镜像');
        });
    });
});
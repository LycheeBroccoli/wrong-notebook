import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MarkdownRenderer } from '@/components/markdown-renderer';

// 从数据库取出的真实笔记内容
const NOTES = "# 解法一：切割线定理（竞赛）\n（1）**证明：**\n因为 $OD \parallel BC$，\n所以 $\angle AOD = \angle B$（两直线平行，同位角相等），\n$\angle DOC = \angle BCO$（两直线平行，内错角相等）．\n\n又因为在 $\odot O$ 中，$OB = OC$，\n所以 $\angle B = \angle BCO$（等边对等角）．\n\n因此 $\angle AOD = \angle DOC$．\n在同圆中，相等的圆心角所对的弧相等，即 $\overset{\frown}{AD} = \overset{\frown}{CD}$，\n所以 $AD = CD$．";

describe('笔记 Markdown 渲染验证', () => {
    it('标题被渲染为 h1', () => {
        const html = renderToStaticMarkup(<MarkdownRenderer content={NOTES} />);
        expect(html).toContain('<h1');
        expect(html).toContain('解法一');
    });

    it('加粗被渲染为 strong', () => {
        const html = renderToStaticMarkup(<MarkdownRenderer content={NOTES} />);
        expect(html).toContain('<strong');
        expect(html).toContain('证明');
    });

    it('LaTeX 公式被 katex 渲染（含 katex 类）', () => {
        const html = renderToStaticMarkup(<MarkdownRenderer content={NOTES} />);
        // remark-math + rehype-katex 会把 $...$ 转成 <span class="katex">
        expect(html).toContain('katex');
    });

    it('原样字面字符不应残留（** 和 $ 不应原样出现）', () => {
        const html = renderToStaticMarkup(<MarkdownRenderer content={NOTES} />);
        expect(html).not.toContain('**证明');
        expect(html).not.toContain('$OD');
    });

    // 证明环境与证毕符号（amsthm 风格）渲染验证
    const PROOF_CONTENT = "\\begin{proof}\n这里是证明过程。\n\\qed\n\\end{proof}\n\n行内证毕：$\\qed$，方块：$\\Box$ $\\square$ $\\blacksquare$，带框空位：$\\boxed{\\phantom{x}}$";

    it('\\qed 被渲染为 katex（证毕符号不报错）', () => {
        const html = renderToStaticMarkup(<MarkdownRenderer content={PROOF_CONTENT} />);
        // 行内 $\qed$ 应被 KaTeX 宏渲染成 katex span
        expect(html).toContain('katex');
        // 不应出现红色错误占位
        expect(html).not.toContain('katex-error');
    });

    it('proof 环境被转成引用块且不含字面环境标记', () => {
        const html = renderToStaticMarkup(<MarkdownRenderer content={PROOF_CONTENT} />);
        // 转成 Markdown 引用块 → <blockquote>
        expect(html).toContain('blockquote');
        // 不应残留字面 \begin{proof} / \end{proof} / 裸 \qed
        expect(html).not.toContain('begin{proof}');
        expect(html).not.toContain('end{proof}');
    });
});

import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import { MarkdownRenderer } from '@/components/markdown-renderer';

// 回归：未被引用的脚注定义不得被静默丢弃。
// 用户报告 bug：解法二里"角平分线定理 / 圆周角定理 / 两割线定理（幂定理）"
// 等定理名没有加粗变蓝。根因：AI 把定理说明写成 `[^n]: **定理名**：...` 脚注
// 定义，但正文里只用自然语言提及、从不写 [^n] 引用标记。remark-gfm 遵循 GFM
// 规范——只在正文中被 [^n] 引用过的脚注定义才渲染成脚注区，从未被引用的定义
// 被静默丢弃，连带 **定理名** 的加粗变蓝一起消失，整段定理说明对读者不可见。
// 修复：promoteUnreferencedFootnotes 把未被引用的 `[^n]: ` 定义行去掉前缀，
// 降级为普通段落，定理名照常加粗变蓝、公式照常渲染。
//
// 最小复现：一条从未被引用的脚注定义，含 **加粗定理名** + 行内公式。
// 未修复时，整条定义被丢弃，html 里既无定理名也无 katex；修复后定理名加粗变蓝。

const UNREFERENCED_FOOTNOTE = [
    '解法二用到角平分线定理。',
    '',
    '[^1]: **角平分线定理**：在 \\(\\triangle ABC\\) 中，角平分线分对边之比等于邻边之比。',
].join('\n');

// 对照组：被引用的脚注定义应保持脚注形态（不降级为正文段落）
const REFERENCED_FOOTNOTE = [
    '解法二用到角平分线定理[^1]。',
    '',
    '[^1]: **角平分线定理**：在 \\(\\triangle ABC\\) 中，角平分线分对边之比等于邻边之比。',
].join('\n');

describe('未被引用的脚注定义提升为可见正文（定理名加粗变蓝回归）', () => {
    it('未被引用的脚注定义：定理名加粗变蓝、公式渲染，不被丢弃', () => {
        const html = renderToStaticMarkup(
            React.createElement(MarkdownRenderer, { content: UNREFERENCED_FOOTNOTE, highlightBold: true }),
        );
        // 定理名应出现在 <strong> 里且变蓝
        expect(html).toMatch(/<strong[^>]*>[^<]*角平分线定理[^<]*<\/strong>/);
        expect(html).toContain('text-blue-700');
        // 行内公式应渲染为 katex，而非字面 \(...\)
        expect(html).toContain('katex');
        expect(html).not.toContain('\\(');
        // 不应出现脚注区（因为降级成了普通段落）
        expect(html).not.toContain('data-footnotes');
    });

    it('被引用的脚注定义：保持脚注形态，定理名在脚注区内加粗变蓝', () => {
        const html = renderToStaticMarkup(
            React.createElement(MarkdownRenderer, { content: REFERENCED_FOOTNOTE, highlightBold: true }),
        );
        // 应有脚注区与上标引用
        expect(html).toContain('data-footnotes');
        expect(html).toContain('<sup');
        // 定理名仍在 <strong> 里加粗变蓝
        expect(html).toMatch(/<strong[^>]*>[^<]*角平分线定理[^<]*<\/strong>/);
        expect(html).toContain('text-blue-700');
    });
});

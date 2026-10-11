import { remark } from 'remark';
import stripMarkdown from 'strip-markdown';

/**
 * 把 ChatGPT 风格的 LaTeX 原生分隔符归一化为 remark-math 认识的 $ 风格。
 * remark-math@6 只认 $ / $$，对 \(...\) 和 \[...\] 完全不可见（会当字面量吐出）。
 *  - 行内 \( ... \)  → $ ... $
 *  - 块级 \[ ... \]  → $$ ... $$
 * 必须在内容进入 remark-math 之前调用。
 *
 * 安全性：只匹配反斜杠+括号的定界符，不碰裸括号——
 * 脚注 [1]、分式 \frac{a}{b} 的 {}、\left[ \right]、\sqrt[3]、bmatrix 等均不受影响。
 * 已用 14 个边界用例实测确认（见 tmp/delim-test.mjs）。
 * 非贪婪 [\s\S]*? 防止跨块吞并；未闭合的孤立 \( 无配对 \) 不命中，原样保留。
 */
export function normalizeMathDelimiters(content: string): string {
    if (!content) return content;
    return content
        // 块级 \[ ... \] → $$ ... $$（先于行内，避免 \[ 被行内规则误匹配）
        .replace(/\\\[([\s\S]*?)\\\]/g, (_m, body: string) => `$$${body}$$`)
        // 行内 \( ... \) → $ ... $
        .replace(/\\\(([\s\S]*?)\\\)/g, (_m, body: string) => `$${body}$`);
}

/**
 * 把"从未被引用的脚注定义"提升为可见正文。
 *
 * 背景：remark-gfm 的脚注遵循 GFM 规范——**只在正文中被 [^n] 引用过的脚注定义**
 * 才会渲染成脚注区；从未被引用的定义会被静默丢弃。AI（如 Gemini）常把定理说明
 * 写成 `[^1]: **定理名**：...` 的脚注定义形式，却在正文里只用"由角平分线定理"
 * 这样的自然语言提及、从不写 [^1] 引用标记，导致整段定理说明（含加粗变蓝的
 * 定理名）对读者完全不可见。
 *
 * 本函数：扫描出所有被引用的脚注标签，对未被引用的 `[^n]: ` 定义行去掉前缀，
 * 使其降级为普通段落（定理名 **加粗**、公式等照常渲染）。已被引用的定义保持原样，
 * 仍走脚注区。
 *
 * 必须在 normalizeMathDelimiters 之后、进入 remark 之前调用。
 */
export function promoteUnreferencedFootnotes(content: string): string {
    if (!content) return content;
    // 收集所有被"引用"的脚注标签：[^n] 但其后不跟 ':'（紧跟 ':' 的是定义本身）
    const referenced = new Set<string>();
    const refRe = /\[\^([^\]]+)\](?!:)/g;
    let m: RegExpExecArray | null;
    while ((m = refRe.exec(content)) !== null) referenced.add(m[1]);
    // 对未被引用的定义行去掉 `[^n]: ` 前缀，降级为普通段落
    return content.replace(/^\[\^([^\]]+)\]:[ \t]?/gm, (full, label: string) =>
        referenced.has(label) ? full : '',
    );
}

/**
 * Clean markdown content to plain text.
 * Note: This function is synchronous and uses remark.processSync.
 */
export function cleanMarkdown(content: string): string {
    if (!content) return "";

    try {
        // 1. First, handle custom LaTeX-like escape sequences that remark might not catch or handle as we want
        // Specifically, handle escaped underscores manually before markdown stripping
        // because we want "\_" to become "_" (plain text underscore), not removed entirely
        let text = content.replace(/\\_/g, '_');

        // 先把 ChatGPT 风格分隔符 \(...\) / \[...\] 归一化为 $ / $$，
        // 这样下方 .replace(/\$/g,'') 能一并剥掉，避免残留字面 ( ) [ ]
        text = normalizeMathDelimiters(text);

        // 2. Use remark to strip markdown formatting
        const file = remark().use(stripMarkdown as any).processSync(text);
        text = String(file);

        // 3. Post-processing: specific cleanups for this app
        // Remove common LaTeX commands that might remain as plain text
        text = text
            // Layout commands
            .replace(/\\left/g, '')
            .replace(/\\right/g, '')
            .replace(/\\begin\{.*?\}/g, '')
            .replace(/\\end\{.*?\}/g, '')
            .replace(/\\text\{.*?\}/g, '')
            .replace(/\\mbox\{.*?\}/g, '')
            // Math structures (Simple recursive patterns are not supported in JS regex, so we handle basic cases)
            .replace(/\\frac\s*\{([^{}]+)\}\s*\{([^{}]+)\}/g, '$1/$2')
            .replace(/\\sqrt\s*\{([^{}]+)\}/g, '√$1')
            .replace(/\^\{([^{}]+)\}/g, '^$1')
            .replace(/_\{([^{}]+)\}/g, '_$1')
            // Symbols map
            .replace(/\\times/g, '×')
            .replace(/\\div/g, '÷')
            .replace(/\\cdot/g, '·')
            .replace(/\\le/g, '≤')
            .replace(/\\ge/g, '≥')
            .replace(/\\neq/g, '≠')
            .replace(/\\approx/g, '≈')
            .replace(/\\pm/g, '±')
            .replace(/\\infty/g, '∞')
            .replace(/\\circ/g, '°')
            .replace(/\\triangle/g, '△')
            .replace(/\\angle/g, '∠')
            .replace(/\\because/g, '∵')
            .replace(/\\therefore/g, '∴')
            // 证毕与方块符号（amsthm 风格），避免纯文本预览退化成裸 qed/blacksquare
            .replace(/\\qed/g, '■')
            .replace(/\\blacksquare/g, '■')
            .replace(/\\Box/g, '□')
            .replace(/\\square/g, '□')
            // Explicitly remove math delimiters ($)
            .replace(/\$/g, '')
            // Cleanup remaining backslashes
            .replace(/\\/g, '')
            .trim();

        return text;
    } catch (error) {
        console.error("Failed to strip markdown:", error);
        // Fallback to original content if stripping fails
        return content;
    }
}

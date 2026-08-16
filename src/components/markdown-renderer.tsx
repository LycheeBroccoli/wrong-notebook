import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import remarkGfm from 'remark-gfm';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';

interface MarkdownRendererProps {
    content: string;
    className?: string;
}

export function MarkdownRenderer({ content, className = '' }: MarkdownRendererProps) {
    // Preprocess content to ensure proper paragraph breaks and LaTeX rendering
    // Convert single line breaks to double line breaks for better readability
    // 闭包数组：临时存放被占位保护的数学块原文，供裸 \qed 替换后按序还原
    const mathStash: string[] = [];
    const processedContent = content
        // Convert literal \n sequences to actual newlines (fix for AI responses)
        // Only convert when NOT followed by a letter, so LaTeX commands beginning
        // with \n (\neq, \nabla, \ne, \neg, \newline, \nonumber, \nu, \notin) are preserved.
        .replace(/\\n(?![A-Za-z])/g, '\n')
        // 把 \begin{proof}...\end{proof} 环境转成 Markdown 引用块，末尾补证毕符号
        // KaTeX 不支持 amsthm 的 proof 环境，这里在预处理层拆解为普通 Markdown
        .replace(/\\begin\{proof\}([\s\S]*?)\\end\{proof\}/g, (_m, body: string) => {
            // 去掉环境内独立的 \qed（避免与末尾补的重复），正文按行加 > 前缀成引用块
            const cleaned = body.replace(/\\qed(?![A-Za-z])/g, '').trim();
            const quoted = cleaned.replace(/^/gm, '> ').replace(/^> $/gm, '>');
            // 末尾证毕符号用 Unicode ■ 直接输出，不经过 $ 定界符，
            // 避免被下方 $-间距正则误拼成 $$ 块级公式
            return `\n\n${quoted}\n> \n> ■\n\n`;
        })
        // 兜底：未被 proof 环境包裹的裸 \qed → 行内证毕符号
        // 必须跳过已在 $...$ / $$...$$ 数学块内的 \qed（那些由 KaTeX 的 \qed 宏处理），
        // 否则把数学块内的 \qed 换成 ■ 会让 KaTeX 报 "Unrecognized Unicode character"。
        // 做法：先把所有数学块占位保护（哨兵  MATH<idx> ，不会出现在正文），
        // 替换剩余裸 \qed，再按序还原数学块原文。
        .replace(/\$\$[\s\S]+?\$\$|\$[^$\n]+?\$/g, (m) => ` MATH${mathStash.push(m) - 1} `)
        .replace(/\\qed(?![A-Za-z])/g, '■')
        .replace(/ MATH(\d+) /g, (_m, i: string) => mathStash[Number(i)])
        // Preserve existing double line breaks with a unique marker
        .replace(/\n\n/g, '\n\n###PRESERVE_BREAK###\n\n')
        // Convert patterns that should be new paragraphs
        .replace(/([。！？；])\n(?!\n)/g, '$1\n\n')  // Chinese punctuation followed by single newline
        .replace(/([.!?;])\s*\n(?!\n)/g, '$1\n\n')   // English punctuation followed by single newline
        .replace(/(\d+\))\s*\n(?!\n)/g, '$1\n\n')    // Numbered items like (1), (2)
        .replace(/([\u2460-\u2473])\s*\n(?!\n)/g, '$1\n\n')  // Circled numbers ①②③
        // Fix: Remove indentation for lines starting with circled numbers or (n) to prevent code block rendering
        .replace(/\n\s+([\u2460-\u2473])/g, '\n$1')
        .replace(/\n\s+(\d+\))/g, '\n$1')
        // Fix LaTeX formulas: Ensure proper spacing around $ delimiters
        // This handles cases where $ might be directly adjacent to text
        .replace(/([^\s$])(\$[^$]+\$)([^\s$])/g, '$1 $2 $3')
        // Restore preserved double line breaks (use flexible whitespace matching)
        .replace(/\s*###PRESERVE_BREAK###\s*/g, '\n\n');

    return (
        <div className={`markdown-content overflow-x-auto min-w-0 ${className}`}>
            <ReactMarkdown
                remarkPlugins={[remarkMath, remarkGfm]}
                rehypePlugins={[[rehypeKatex, {
                    // 注册 KaTeX 不原生支持的 amsthm 证毕符号命令
                    // \qed → \blacksquare（■），与 amsthm 默认行为一致
                    macros: {
                        "\\qed": "\\blacksquare",
                    },
                }]]}
                components={{
                    // 自定义样式
                    h1: ({ node, ...props }) => <h1 className="text-2xl font-bold mt-6 mb-4" {...props} />,
                    h2: ({ node, ...props }) => <h2 className="text-xl font-bold mt-5 mb-3" {...props} />,
                    h3: ({ node, ...props }) => <h3 className="text-lg font-bold mt-4 mb-2" {...props} />,
                    p: ({ node, ...props }) => <p className="mb-3 leading-relaxed" {...props} />,
                    ul: ({ node, ...props }) => <ul className="list-disc list-inside mb-3 space-y-1" {...props} />,
                    ol: ({ node, ...props }) => <ol className="list-decimal list-inside mb-3 space-y-1" {...props} />,
                    li: ({ node, ...props }) => <li className="ml-4" {...props} />,
                    blockquote: ({ node, ...props }) => (
                        <blockquote className="border-l-4 border-primary pl-4 italic my-4 text-muted-foreground" {...props} />
                    ),
                    code: ({ node, inline, className, children, ...props }: any) => {
                        if (inline) {
                            return <code className="bg-muted px-1.5 py-0.5 rounded text-sm font-mono text-foreground" {...props}>{children}</code>;
                        }
                        return (
                            <code className="block bg-muted p-4 rounded-lg overflow-x-auto my-3 font-mono text-sm" {...props}>
                                {children}
                            </code>
                        );
                    },
                    table: ({ node, ...props }) => (
                        <div className="overflow-x-auto my-4">
                            <table className="min-w-full border-collapse border border-border" {...props} />
                        </div>
                    ),
                    th: ({ node, ...props }) => (
                        <th className="border border-border px-4 py-2 bg-muted font-semibold text-left" {...props} />
                    ),
                    td: ({ node, ...props }) => (
                        <td className="border border-border px-4 py-2" {...props} />
                    ),
                    strong: ({ node, ...props }) => <strong className="font-bold text-foreground" {...props} />,
                    em: ({ node, ...props }) => <em className="italic" {...props} />,
                }}
            >
                {processedContent}
            </ReactMarkdown>
        </div>
    );
}

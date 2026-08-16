"use client";

import { MarkdownRenderer } from "@/components/markdown-renderer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function LatexTestPage() {
    const testCases = [
        {
            title: "单个$符号(行内公式)",
            content: "(1) $a = -12$, $b = 8$, $c = 16$ (2) $t = 12$ (3) $M = \\frac{72}{11}$"
        },
        {
            title: "双$符号(独立公式)",
            content: "答案:\n\n$$M = \\frac{72}{11}$$"
        },
        {
            title: "混合格式",
            content: "解:\n\n(1) $a = -12, b = 8, c = 16$\n\n(2) 当 $t = 12$ 时\n\n(3) $M = \\frac{72}{11}$"
        },
        {
            title: "复杂公式",
            content: "二次函数: $y = ax^2 + bx + c$\n\n求根公式: $$x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}$$"
        },
        {
            title: "您的实际答案格式",
            content: "(1) $a = -12$, $b = 8$, $c = 16$ (2) $@t = 12$ (3) $M = \\frac{72}{11}$"
        },
        {
            title: "\\neq 等以 \\n 开头的命令（行内）",
            content: "已知 $a+b+c \\neq 0$，且 $\\nabla f$、$\\neg A$、$a \\ne b$、$\\nu$、$x \\notin S$ 均有定义。"
        },
        {
            title: "\\neq 等命令（块级 + 行内混合，回归 4.2 整段崩塌）",
            content: "#### 情况一：当 $a+b+c\\neq0$ 时\n\n因为 $a+b+c \\neq 0$，得：\n\n$$b+c-a = -2a \\neq 0 \\implies a \\neq 0$$\n\n同理 $b \\neq 0$ 且 $c \\neq 0$。"
        },
        {
            title: "证明环境与证毕符号（amsthm 风格）",
            content: "\\begin{proof}\n这里是证明过程。\n\\qed\n\\end{proof}\n\n行内证毕：$\\qed$，方块：$\\Box$ $\\square$ $\\blacksquare$，带框空位：$\\boxed{\\phantom{x}}$"
        },
        // —— ChatGPT 风格分隔符基础用例 ——
        {
            title: "ChatGPT 行内 \\( ... \\)",
            content: "(1) \\(a = -12\\), \\(b = 8\\), \\(c = 16\\) (2) \\(t = 12\\)"
        },
        {
            title: "ChatGPT 块级 \\[ ... \\]",
            content: "求根公式:\n\n\\[x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}\\]"
        },
        {
            title: "ChatGPT 混合（行内+块级）",
            content: "解:\n\n(1) \\(a = -12, b = 8, c = 16\\)\n\n(2) 当 \\(t = 12\\) 时\n\n(3) \\[M = \\frac{72}{11}\\]"
        },
        // —— 甄别安全性边界用例（验证不误伤裸括号/脚注/分式）——
        {
            title: "裸[]脚注不应被改",
            content: "参考[1]文献，见[3]，且 a[0] 不变"
        },
        {
            title: "裸()文本与 ChatGPT 公式混排",
            content: "(1+2)=3 是普通文本，且 \\(x=1\\) 是公式"
        },
        {
            title: "ChatGPT 行内含分式 \\frac{a}{b}",
            content: "\\(\\frac{a}{b}\\) 的分母分子花括号应保留"
        },
        {
            title: "ChatGPT 行内含 \\left[ \\right]",
            content: "\\(\\left[ a + b \\right]\\) 内部方括号应保留"
        },
        {
            title: "ChatGPT 行内含 \\sqrt[3] 可选参数",
            content: "\\(\\sqrt[3]{x}\\) 的 [3] 应保留"
        },
        {
            title: "ChatGPT 块级含矩阵 bmatrix",
            content: "\\[\\begin{bmatrix}1&2\\\\3&4\\end{bmatrix}\\]"
        },
        {
            title: "Markdown 链接 []() 与公式共存",
            content: "[链接](url) 与 \\(x\\) 共存，链接不应坏"
        },
        {
            title: "未闭合孤立 \\( 应原样保留",
            content: "文本 \\(未闭合 不应被改动"
        },
        // —— Gemini 与 ChatGPT 混排（同一文档两种风格）——
        {
            title: "Gemini $ 与 ChatGPT \\(\\) 混排",
            content: "\\(a=1\\) 且 $b=2$，块级 \\[c=3\\] 与 $$d=4$$"
        }
    ];

    return (
        <div className="container mx-auto p-8 max-w-4xl">
            <h1 className="text-3xl font-bold mb-6">LaTeX 渲染测试</h1>

            <div className="space-y-6">
                {testCases.map((test, index) => (
                    <Card key={index}>
                        <CardHeader>
                            <CardTitle className="text-lg">{test.title}</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div>
                                <h4 className="text-sm font-semibold text-muted-foreground mb-2">原始文本:</h4>
                                <pre className="bg-muted p-3 rounded text-xs overflow-x-auto">
                                    {test.content}
                                </pre>
                            </div>
                            <div>
                                <h4 className="text-sm font-semibold text-muted-foreground mb-2">渲染结果:</h4>
                                <div className="border rounded p-4 bg-background">
                                    <MarkdownRenderer content={test.content} />
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>

            <Card className="mt-8 border-yellow-500/50 bg-yellow-50/50">
                <CardHeader>
                    <CardTitle className="text-yellow-700">💡 LaTeX 公式格式说明</CardTitle>
                </CardHeader>
                <CardContent className="text-sm space-y-2">
                    <p>• <strong>行内公式</strong>: 使用单个 <code>$</code> 包裹,如 <code>$x^2$</code></p>
                    <p>• <strong>独立公式</strong>: 使用双 <code>$$</code> 包裹,如 <code>$$\\frac{"{a}"}{"{b}"}$$</code></p>
                    <p>• <strong>分数</strong>: <code>\\frac{"{分子}"}{"{分母}"}</code></p>
                    <p>• <strong>根号</strong>: <code>\\sqrt{"{内容}"}</code></p>
                    <p>• <strong>上标</strong>: <code>x^2</code> 或 <code>x^{"{2n}"}</code></p>
                    <p>• <strong>下标</strong>: <code>x_1</code> 或 <code>x_{"{n+1}"}</code></p>
                </CardContent>
            </Card>
        </div>
    );
}

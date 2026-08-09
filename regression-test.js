// 回归测试：验证 markdown-renderer.tsx 修复后的预处理管线
// 覆盖：用户真实内容 + 所有 \n 开头 LaTeX 命令 + 字面 \n 兜底 + 混合内容
// 用 String.raw 保证反斜杠不被 shell 转义

let passed = 0, failed = 0;
function assert(name, cond, detail = '') {
    if (cond) { passed++; console.log(`  ✓ ${name}`); }
    else { failed++; console.log(`  ✗ ${name}  ${detail}`); }
}

// === 复制修复后 markdown-renderer.tsx 的完整预处理管线 ===
function preprocess(content) {
    return content
        .replace(/\\n(?![A-Za-z])/g, '\n')
        .replace(/\n\n/g, '\n\n###PRESERVE_BREAK###\n\n')
        .replace(/([。！？；])\n(?!\n)/g, '$1\n\n')
        .replace(/([.!?;])\s*\n(?!\n)/g, '$1\n\n')
        .replace(/(\d+\))\s*\n(?!\n)/g, '$1\n\n')
        .replace(/([①-⑳])\s*\n(?!\n)/g, '$1\n\n')
        .replace(/\n\s+([①-⑳])/g, '\n$1')
        .replace(/\n\s+(\d+\))/g, '\n$1')
        .replace(/([^\s$])(\$[^$]+\$)([^\s$])/g, '$1 $2 $3')
        .replace(/\s*###PRESERVE_BREAK###\s*/g, '\n\n');
}

// 统计单 $ 未闭合行数（级联错位指标）
function orphanDollarCount(text) {
    let n = 0;
    for (const line of text.split('\n')) {
        const single = (line.match(/(?<!\$)\$(?!\$)/g) || []).length;
        if (single % 2 !== 0) n++;
    }
    return n;
}

// ============================================================
// 测试 1：用户真实内容（现象 3、4.1、4.2 的源头）
// ============================================================
console.log('\n[测试1] 用户真实内容 — 7 个 \\neq，含行内+块级');
const real = String.raw`#### 情况一：当 $a+b+c\neq0$ 时

因为 $a+b+c \neq 0$，等式两边可同时除以 $(a+b+c)$，得：

$$\frac{a}{b+c-a} + \frac{b}{c+a-b} + \frac{c}{a+b-c} - 1 = 0$$

分母 $b+c-a \neq 0$。

将 $b+c = -a$ 代入分母 $b+c-a$ 中，得：

$$b+c-a = (-a) - a = -2a \neq 0 \implies a \neq 0$$

同理可证 $b \neq 0$ 且 $c \neq 0$。`;
const realP = preprocess(real);
assert('\\neq 全部保留', (realP.match(/\\neq/g) || []).length === 7, `实际: ${(realP.match(/\\neq/g)||[]).length}`);
assert('无单$未闭合行（4.2 崩塌消除）', orphanDollarCount(realP) === 0, `实际: ${orphanDollarCount(realP)}`);
// 注意：原有的"加空格"正则会在公式结尾$后插空格（如 $...$  → $...$ ），
// 这是既有行为，与本次\neq修复无关，KaTeX仍能正确渲染。断言只验证\neq本身完整。
assert('$a+b+c\\neq0 公式内\\neq完整', /\$a\+b\+c\\neq0/.test(realP), `实际片段: ${JSON.stringify(realP.substring(0, 40))}`);

// ============================================================
// 测试 2：所有 \n 开头的 LaTeX 命令（行内公式）
// ============================================================
console.log('\n[测试2] 所有 \\n 开头命令 — 行内公式');
const inlineCmds = String.raw`行内：$a \neq b$，$\nabla f$，$\neg A$，$a \ne b$，$\nu$，$x \notin S$，末尾 $\newline$。`;
const inlineP = preprocess(inlineCmds);
for (const cmd of ['\\neq', '\\nabla', '\\neg', '\\ne', '\\nu', '\\notin', '\\newline']) {
    assert(`行内 ${cmd} 保留`, inlineP.includes(cmd), `处理后缺失 ${cmd}`);
}
assert('行内无单$未闭合行', orphanDollarCount(inlineP) === 0, `实际: ${orphanDollarCount(inlineP)}`);

// ============================================================
// 测试 3：所有 \n 开头的 LaTeX 命令（块级公式）
// ============================================================
console.log('\n[测试3] 所有 \\n 开头命令 — 块级公式');
const displayCmds = String.raw`块级：

$$\neq,\ \nabla,\ \neg,\ \ne,\ \nu,\ \notin,\ \newline,\ \nonumber$$`;
const displayP = preprocess(displayCmds);
for (const cmd of ['\\neq', '\\nabla', '\\neg', '\\ne', '\\nu', '\\notin', '\\newline', '\\nonumber']) {
    assert(`块级 ${cmd} 保留`, displayP.includes(cmd), `处理后缺失 ${cmd}`);
}

// ============================================================
// 测试 4：字面 \n 兜底仍生效（AI 返回字面反斜杠+n）
// ============================================================
console.log('\n[测试4] 字面 \\n 兜底 — 后跟非字母时仍转换行');
const literal = String.raw`第一行\n第二行\n。句号后\n数字`;
const literalP = preprocess(literal);
assert('字面\\n(后跟中文)转成换行', literalP.includes('第一行\n第二行'));
assert('字面\\n(后跟句号)转成换行', literalP.includes('\n。句号后'));

// ============================================================
// 测试 5：字面 \n 后跟英文单词 — 边界情况
// ============================================================
console.log('\n[测试5] 边界 — 字面 \\n 后跟英文（被保护，不转换行）');
const edge = String.raw`文本\nHello 世界`;
const edgeP = preprocess(edge);
assert('字面\\n后跟字母被保护（不转换行）', edgeP.includes('\\nHello'), `实际: ${JSON.stringify(edgeP)}`);

// ============================================================
// 测试 6：混合内容（公式 + 字面\n + 标点断段）
// ============================================================
console.log('\n[测试6] 混合 — 公式 + 字面\\n + 中文标点断段');
const mixed = String.raw`已知 $a \neq 0$。\n求证 $b \nabla c$。\n证毕。`;
const mixedP = preprocess(mixed);
assert('\\neq 保留', mixedP.includes('\\neq'));
assert('\\nabla 保留', mixedP.includes('\\nabla'));
assert('无单$未闭合行', orphanDollarCount(mixedP) === 0, `实际: ${orphanDollarCount(mixedP)}`);

// ============================================================
// 测试 7：原 bug 复现确认 — 旧正则会破坏，新正则不破坏（对照）
// ============================================================
console.log('\n[测试7] 对照 — 旧正则破坏 vs 新正则保护');
const oldP = real.replace(/\\n/g, '\n');
const newP = preprocess(real);
assert('旧正则破坏 \\neq（确认 bug 存在）', (oldP.match(/\\neq/g) || []).length === 0, '旧正则未破坏？');
assert('新正则保护 \\neq（确认修复生效）', (newP.match(/\\neq/g) || []).length === 7);

// ============================================================
// 测试 8：\text{...} 命令（用户原文有 \text{或}）不受影响
// ============================================================
console.log('\n[测试8] \\text 命令 — 非 \\n 开头，不受影响');
const textCmd = String.raw`当 $x>0$ \text{或} $x<0$ 时`;
const textP = preprocess(textCmd);
assert('\\text 保留', textP.includes('\\text'), `实际: ${JSON.stringify(textP)}`);
assert('无单$未闭合行', orphanDollarCount(textP) === 0, `实际: ${orphanDollarCount(textP)}`);

// ============================================================
console.log(`\n========================================`);
console.log(`通过 ${passed} / 失败 ${failed}`);
console.log(failed === 0 ? '✅ 全部通过' : '❌ 有失败用例');
process.exit(failed === 0 ? 0 : 1);

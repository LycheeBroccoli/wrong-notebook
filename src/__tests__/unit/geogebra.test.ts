import { describe, it, expect } from 'vitest';

// Test parseCommands function logic
function parseCommands(raw: string): string[] {
    if (!raw?.trim()) return [];
    const t = raw.trim();
    if (t.startsWith("[")) {
        try {
            const a = JSON.parse(t);
            if (Array.isArray(a))
                return a.filter((c): c is string => typeof c === "string" && c.trim() !== "");
        } catch { /* fall through */ }
    }
    return t.split("\n").map((c) => c.trim()).filter((c) => c && !c.startsWith("//"));
}

// Test parseApiArgs function logic (safe version)
function parseApiArgs(cmd: string): { m: string; a: unknown[] } | null {
    const m = cmd.match(/^(\w+)\(([\s\S]+)\)$/);
    if (!m) return null;
    try {
        const argsStr = m[2].trim();
        if (argsStr.startsWith('[') && argsStr.endsWith(']')) {
            return { m: m[1], a: JSON.parse(argsStr) };
        }
        if (/^-?\d+(\.\d+)?$/.test(argsStr)) {
            return { m: m[1], a: [Number(argsStr)] };
        }
        if (argsStr === 'true' || argsStr === 'false') {
            return { m: m[1], a: [argsStr === 'true'] };
        }
        if ((argsStr.startsWith('"') && argsStr.endsWith('"')) ||
            (argsStr.startsWith("'") && argsStr.endsWith("'"))) {
            return { m: m[1], a: [argsStr.slice(1, -1)] };
        }
        const parts = argsStr.split(',').map(s => s.trim());
        const parsed: unknown[] = parts.map(p => {
            if (/^-?\d+(\.\d+)?$/.test(p)) return Number(p);
            if (p === 'true' || p === 'false') return p === 'true';
            if ((p.startsWith('"') && p.endsWith('"')) ||
                (p.startsWith("'") && p.endsWith("'"))) return p.slice(1, -1);
            return p;
        });
        return { m: m[1], a: parsed };
    }
    catch { return null; }
}

// Test isApiCall function logic
const API_PREFIXES = [
    "setcoordsystem", "setcoords", "setaxesvisible", "setgridvisible", "setcolor",
    "setlinethickness", "setlinestyle", "setpointsize", "setpointstyle",
    "setlabelvisible", "setcaption", "setvisible", "setfilling",
    "setvalue", "setfixed", "setbackgroundcolor",
];

function isApiCall(cmd: string): boolean {
    const l = cmd.toLowerCase().trim();
    return API_PREFIXES.some((p) => l.startsWith(p + "("));
}

describe('GeoGebra Commands', () => {
    describe('parseCommands', () => {
        it('should parse JSON array of commands', () => {
            const input = '["f(x) = x^2", "A = (1, 2)"]';
            expect(parseCommands(input)).toEqual(['f(x) = x^2', 'A = (1, 2)']);
        });

        it('should parse newline-separated commands', () => {
            const input = 'f(x) = x^2\nA = (1, 2)\nSegment(A, B)';
            expect(parseCommands(input)).toEqual(['f(x) = x^2', 'A = (1, 2)', 'Segment(A, B)']);
        });

        it('should filter empty lines and comments', () => {
            const input = 'f(x) = x^2\n// This is a comment\n\nA = (1, 2)';
            expect(parseCommands(input)).toEqual(['f(x) = x^2', 'A = (1, 2)']);
        });

        it('should return empty array for empty input', () => {
            expect(parseCommands('')).toEqual([]);
            expect(parseCommands('   ')).toEqual([]);
            expect(parseCommands(null as any)).toEqual([]);
        });

        it('should filter non-string items from JSON array', () => {
            const input = '["f(x) = x^2", 123, null, "A = (1, 2)"]';
            expect(parseCommands(input)).toEqual(['f(x) = x^2', 'A = (1, 2)']);
        });
    });

    describe('parseApiArgs', () => {
        it('should parse numeric arguments', () => {
            expect(parseApiArgs('setCoordSystem(-10, 10, -10, 10)')).toEqual({
                m: 'setCoordSystem',
                a: [-10, 10, -10, 10]
            });
        });

        it('should parse boolean arguments', () => {
            expect(parseApiArgs('setAxesVisible(true, false)')).toEqual({
                m: 'setAxesVisible',
                a: [true, false]
            });
        });

        it('should parse string arguments', () => {
            expect(parseApiArgs('setColor("A", 255, 0, 0)')).toEqual({
                m: 'setColor',
                a: ['A', 255, 0, 0]
            });
        });

        it('should parse single numeric argument', () => {
            expect(parseApiArgs('setLineThickness(3)')).toEqual({
                m: 'setLineThickness',
                a: [3]
            });
        });

        it('should parse array argument', () => {
            expect(parseApiArgs('setValues([1, 2, 3])')).toEqual({
                m: 'setValues',
                a: [1, 2, 3]
            });
        });

        it('should return null for invalid input', () => {
            expect(parseApiArgs('invalid')).toBeNull();
            expect(parseApiArgs('')).toBeNull();
        });
    });

    describe('isApiCall', () => {
        it('should identify API calls', () => {
            expect(isApiCall('setCoordSystem(-10, 10, -10, 10)')).toBe(true);
            expect(isApiCall('setAxesVisible(true, true)')).toBe(true);
            expect(isApiCall('setColor("A", 255, 0, 0)')).toBe(true);
        });

        it('should not identify regular commands as API calls', () => {
            expect(isApiCall('f(x) = x^2')).toBe(false);
            expect(isApiCall('A = (1, 2)')).toBe(false);
            expect(isApiCall('Segment(A, B)')).toBe(false);
        });

        it('should be case insensitive', () => {
            expect(isApiCall('SETCOORDSYSTEM(-10, 10, -10, 10)')).toBe(true);
            expect(isApiCall('SetAxesVisible(true, true)')).toBe(true);
        });

        // Regression: setCoords (path-constrained point placement) must route to
        // the JS API path (api.setCoords), NOT fall through to evalCommand where
        // GeoGebra's command DSL rejects lowercase 'setCoords' as "未知的指令".
        // The AI emits 'setCoords' (lowercase s) per the prompt, matching the JS
        // API method name. Prefix match is case-insensitive so all casings route.
        it('should route setCoords as an API call (not evalCommand)', () => {
            expect(isApiCall('setCoords("A", 1, 2)')).toBe(true);
            expect(isApiCall('SetCoords("A", 1, 2)')).toBe(true);
            expect(isApiCall('SETCOORDS("A", 1, 2)')).toBe(true);
        });

        it('should not mis-route setCoordSystem as setCoords', () => {
            // setCoordSystem must still match setCoordSystem, not get shadowed
            expect(isApiCall('setCoordSystem(-10, 10, -10, 10)')).toBe(true);
            // And parseApiArgs must extract the full method name, not truncate
            expect(parseApiArgs('setCoordSystem(-10, 10, -10, 10)')?.m).toBe('setCoordSystem');
            expect(parseApiArgs('setCoords("A", 1, 2)')?.m).toBe('setCoords');
        });
    });

    // Mirrors shouldEvalInsteadOfApi in geogebra-demo.tsx. setCoords/setValue 的
    // 坐标/值参数含变量时，JS API 不求值表达式字符串 → 改走 evalCommand（DSL 求值）。
    function findTopLevelCommaInArgs(s: string): number {
        let depth = 0;
        let inStr: string | null = null;
        for (let i = 0; i < s.length; i++) {
            const ch = s[i];
            if (inStr) {
                if (ch === inStr && s[i - 1] !== '\\') inStr = null;
                continue;
            }
            if (ch === '"' || ch === "'") { inStr = ch; continue; }
            if (ch === '{' || ch === '[') { depth++; continue; }
            if (ch === '}' || ch === ']') { depth--; continue; }
            if (ch === ',' && depth === 0) return i;
        }
        return -1;
    }
    function splitTopLevelCommas(s: string): string[] {
        const parts: string[] = [];
        let depth = 0;
        let inStr: string | null = null;
        let cur = '';
        for (let i = 0; i < s.length; i++) {
            const ch = s[i];
            if (inStr) { cur += ch; if (ch === inStr && s[i - 1] !== '\\') inStr = null; continue; }
            if (ch === '"' || ch === "'") { inStr = ch; cur += ch; continue; }
            if (ch === '{' || ch === '[') { depth++; cur += ch; continue; }
            if (ch === '}' || ch === ']') { depth--; cur += ch; continue; }
            if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; continue; }
            cur += ch;
        }
        if (cur.trim()) parts.push(cur);
        return parts;
    }
    function shouldEvalInsteadOfApi(cmd: string): boolean {
        const m = cmd.trim().match(/^(setCoords|setValue)\s*\(([\s\S]+)\)$/i);
        if (!m) return false;
        const argsStr = m[2];
        const firstComma = findTopLevelCommaInArgs(argsStr);
        if (firstComma === -1) return false;
        const rest = argsStr.substring(firstComma + 1);
        const parts = splitTopLevelCommas(rest);
        return parts.some((p) => {
            const t = p.trim();
            if (/^-?\d+(\.\d+)?$/.test(t)) return false;
            if (t === 'true' || t === 'false') return false;
            if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) return false;
            return true;
        });
    }

    describe('shouldEvalInsteadOfApi (setCoords/setValue with variable args)', () => {
        // 含变量的坐标表达式必须走 evalCommand（DSL 求值），否则 JS API 收到
        // 字符串 "s / 2" 不求值，点不移动。
        it('should route setCoords with variable expression to evalCommand', () => {
            expect(shouldEvalInsteadOfApi('setCoords("D", s / 2, -s * sqrt(3) / 6)')).toBe(true);
            expect(shouldEvalInsteadOfApi('setCoords("D", x(A), y(B))')).toBe(true);
            expect(shouldEvalInsteadOfApi('setCoords("D", s / 2, -1.1547)')).toBe(true);
        });

        // 纯数值 setCoords 仍走 JS API（行为不变，回归保护）
        it('should keep numeric setCoords on JS API path', () => {
            expect(shouldEvalInsteadOfApi('setCoords("D", 2, -1.1547)')).toBe(false);
            expect(shouldEvalInsteadOfApi('setCoords("A", 0, 0)')).toBe(false);
            expect(shouldEvalInsteadOfApi('SetCoords("A", 1, 2)')).toBe(false);
        });

        it('should handle setValue with variable expression', () => {
            expect(shouldEvalInsteadOfApi('setValue("s", 4)')).toBe(false);
            expect(shouldEvalInsteadOfApi('setValue("t", s + 1)')).toBe(true);
        });

        it('should not affect non-setCoords/setValue API calls', () => {
            expect(shouldEvalInsteadOfApi('setColor("A", 255, 0, 0)')).toBe(false);
            expect(shouldEvalInsteadOfApi('setCoordSystem(-10, 10, -10, 10)')).toBe(false);
            expect(shouldEvalInsteadOfApi('setLabelVisible("A", true)')).toBe(false);
        });
    });

    describe('Command Safety', () => {
        // Mirrors the filter in geogebra-demo.tsx runCommands.
        // GeoGebra's evalCommand parses the math DSL, NOT HTML/JS, so < > are
        // legal comparison operators (>=, <=, <, >) inside If(...) etc.
        // We block only HTML-tag-shaped patterns (</?tag) for defense-in-depth.
        // Apostrophe (A'/B'/M' transform points) and double-quote (Text("..."))
        // are also legal DSL syntax and must NOT be blocked.
        // Regression: If(Length(listD) >= 1, Element(listD, 1), (0,0)) was being
        // blocked by a naive /[<>]/ test, leaving point D undefined and
        // cascading E = Rotate(D,...) into "未定义变量 D、E".
        const isBlocked = (cmd: string) => /<\/?[a-zA-Z][\w\-]*[\s>]/.test(cmd) || /<\/[a-zA-Z]/.test(cmd);

        it('should reject commands with HTML-like angle brackets', () => {
            const unsafeCommands = [
                '<script>alert("xss")</script>',
                'f(x) = <img src=x>',
                '<svg onload=alert(1)>',
            ];

            for (const cmd of unsafeCommands) {
                expect(isBlocked(cmd)).toBe(true);
            }
        });

        it('should allow comparison operators in If/Length commands (>=, <=, <, >)', () => {
            // Regression for the D/E/listD undefined bug: the If guard uses >=
            // which a naive /[<>]/ filter blocked, so D was never created.
            const comparisonCommands = [
                'D = If(Length(listD) >= 1, Element(listD, 1), (0, 0))',
                'P = If(a < b, A, B)',
                'Q = If(x >= 0, (1, 2), (3, 4))',
                'R = If(Length(L) <= 2, Element(L, 1), (NaN, NaN))',
                'm = Max(a, b)',
            ];

            for (const cmd of comparisonCommands) {
                expect(isBlocked(cmd)).toBe(false);
            }
        });

        it('should allow apostrophe transform-point commands', () => {
            const transformCommands = [
                "A' = Dilate(A, -0.5, O)",
                "B' = Dilate(B, -0.5, O)",
                "t2 = Polygon(A', B', C')",
                "l1 = Line(A, A')",
                "M' = Dilate(M, -0.5, O)",
                "l4 = Segment(M, M')",
            ];

            for (const cmd of transformCommands) {
                expect(isBlocked(cmd)).toBe(false);
            }
        });

        it('should allow double-quote text commands', () => {
            const textCommands = [
                'Text("提示", (1, 2))',
                'SetCaption("A撇")',
            ];

            for (const cmd of textCommands) {
                expect(isBlocked(cmd)).toBe(false);
            }
        });

        it('should allow safe commands', () => {
            const safeCommands = [
                'f(x) = x^2',
                'A = (1, 2)',
                'Segment(A, B)',
                'Circle(A, 3)',
                'setCoordSystem(-10, 10, -10, 10)'
            ];

            for (const cmd of safeCommands) {
                expect(isBlocked(cmd)).toBe(false);
            }
        });
    });

    describe('GeogebraAnalysisResult', () => {
        it('should have correct structure', () => {
            const result = {
                suitable: true,
                commands: ['f(x) = x^2', 'A = (1, 2)'],
                description: '二次函数图像'
            };

            expect(result).toHaveProperty('suitable');
            expect(result).toHaveProperty('commands');
            expect(result).toHaveProperty('description');
            expect(typeof result.suitable).toBe('boolean');
            expect(Array.isArray(result.commands)).toBe(true);
            expect(typeof result.description).toBe('string');
        });

        it('should handle unsuitable result', () => {
            const result = {
                suitable: false,
                commands: [],
                description: '不适合用 GeoGebra 演示'
            };

            expect(result.suitable).toBe(false);
            expect(result.commands).toHaveLength(0);
        });
    });
});

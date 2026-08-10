"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Maximize2, Minimize2, RotateCcw, RefreshCw } from "lucide-react";
import { frontendLogger } from "@/lib/frontend-logger";

interface GeogebraDemoProps {
    commands: string;
    height?: number;
    showToolBar?: boolean;
    showAlgebraInput?: boolean;
    showMenuBar?: boolean;
    className?: string;
    /** Called when user clicks "重新生成" — parent should re-call AI and update commands */
    onRegenerate?: () => Promise<void>;
}

// ── Singleton script loader ─────────────────────────────────────────────
let ggbScriptPromise: Promise<void> | null = null;

function loadGeoGebraScript(): Promise<void> {
    if (ggbScriptPromise) return ggbScriptPromise;
    ggbScriptPromise = new Promise<void>((resolve, reject) => {
        if (typeof window !== "undefined" && (window as any).GGBApplet) {
            resolve();
            return;
        }
        const s = document.createElement("script");
        s.src = "https://www.geogebra.org/apps/deployggb.js";
        s.async = true;
        s.onload = () => resolve();
        s.onerror = () => {
            ggbScriptPromise = null;
            reject(new Error("Failed to load GeoGebra"));
        };
        document.head.appendChild(s);
    });
    return ggbScriptPromise;
}

// ── Command helpers ─────────────────────────────────────────────────────
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

const API_PREFIXES = [
    "setcoordsystem", "setaxesvisible", "setaxislabels", "setaxissteps",
    "setaxisunits", "setgridvisible", "setgraphicsoptions", "setcolor",
    "setlinethickness", "setlinestyle", "setpointsize", "setpointstyle",
    "setlabelvisible", "setcaption", "setvisible", "setfilling",
    "setvalue", "setfixed", "setbackgroundcolor", "setsize", "setwidth", "setheight",
];

function isApiCall(cmd: string): boolean {
    const l = cmd.toLowerCase().trim();
    return API_PREFIXES.some((p) => l.startsWith(p + "("));
}

function parseApiArgs(cmd: string): { m: string; a: unknown[] } | null {
    const m = cmd.match(/^(\w+)\(([\s\S]+)\)$/);
    if (!m) return null;
    try {
        // Safe parsing: only allow numbers, booleans, strings, arrays, and objects
        const argsStr = m[2].trim();
        // Single JSON array: [1, 2, 3] or ["a", "b"]
        if (argsStr.startsWith('[') && argsStr.endsWith(']')) {
            return { m: m[1], a: JSON.parse(argsStr) };
        }
        // Single JSON object: {...} (e.g. setGraphicsOptions options arg)
        if (argsStr.startsWith('{') && argsStr.endsWith('}')) {
            return { m: m[1], a: [JSON.parse(argsStr)] };
        }
        // Single value: number, boolean, or quoted string
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
        // Multiple comma-separated values — but split respecting nested {} and []
        // (so setGraphicsOptions(1, {axes:{...}}) doesn't get torn apart)
        const parts = splitTopLevelCommas(argsStr);
        const parsed: unknown[] = parts.map(p => {
            const t = p.trim();
            // JSON object or array argument
            if ((t.startsWith('{') && t.endsWith('}')) ||
                (t.startsWith('[') && t.endsWith(']'))) {
                try { return JSON.parse(t); } catch { return t; }
            }
            if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
            if (t === 'true' || t === 'false') return t === 'true';
            if ((t.startsWith('"') && t.endsWith('"')) ||
                (t.startsWith("'") && t.endsWith("'"))) return t.slice(1, -1);
            return t; // Keep as string for object names etc.
        });
        return { m: m[1], a: parsed };
    }
    catch { return null; }
}

// Split a comma-separated arg string at top-level commas only,
// so nested {} and [] blocks stay intact.
function splitTopLevelCommas(s: string): string[] {
    const parts: string[] = [];
    let depth = 0;
    let inStr: string | null = null;
    let cur = '';
    for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (inStr) {
            cur += ch;
            if (ch === inStr && s[i - 1] !== '\\') inStr = null;
            continue;
        }
        if (ch === '"' || ch === "'") { inStr = ch; cur += ch; continue; }
        if (ch === '{' || ch === '[') { depth++; cur += ch; continue; }
        if (ch === '}' || ch === ']') { depth--; cur += ch; continue; }
        if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; continue; }
        cur += ch;
    }
    if (cur.trim()) parts.push(cur);
    return parts;
}

function runCommands(api: any, cmds: string[]) {
    let ok = 0, fail = 0, blocked = 0;
    const failures: string[] = [];
    for (const cmd of cmds) {
        try {
            if (isApiCall(cmd)) {
                const p = parseApiArgs(cmd);
                if (!p) {
                    blocked++;
                    frontendLogger.warn('[GGB]', 'Invalid API call', { cmd });
                } else if (typeof api[p.m] !== 'function') {
                    blocked++;
                    frontendLogger.warn('[GGB]', 'Unsupported API method', { method: p.m, cmd });
                } else {
                    api[p.m](...p.a);
                    ok++;
                }
            } else {
                // Block only < > for HTML-tag defense-in-depth.
                // Apostrophe (A'/B'/M' transform points) and double-quote (Text("..."))
                // are legal GeoGebra DSL syntax — evalCommand parses GeoGebra's math
                // grammar, not HTML/JS, so they are not XSS vectors.
                const sanitized = cmd.trim();
                if (sanitized && !/[<>]/.test(sanitized)) {
                    const success = api.evalCommand(sanitized);
                    if (!success) {
                        fail++;
                        failures.push(sanitized);
                        frontendLogger.warn('[GGB]', 'Command execution failed', { cmd: sanitized });
                    } else {
                        ok++;
                    }
                } else {
                    blocked++;
                    frontendLogger.warn('[GGB]', 'Blocked potentially unsafe command', { cmd: cmd.substring(0, 50) });
                }
            }
        } catch (e) {
            fail++;
            failures.push(cmd);
            frontendLogger.error('[GGB]', 'Command threw', { cmd, error: String(e) });
        }
    }
    frontendLogger.info('[GGB]', 'runCommands done', { total: cmds.length, ok, fail, blocked, failures: failures.slice(0, 5) });
}

// ── Component ───────────────────────────────────────────────────────────
export function GeogebraDemo({
    commands,
    height = 450,
    showToolBar = false,
    showAlgebraInput = false,
    showMenuBar = false,
    className = "",
    onRegenerate,
}: GeogebraDemoProps) {
    // This ref points to a div that React NEVER puts children into.
    // All GeoGebra DOM is injected via innerHTML in the effect, so
    // React's reconciler never touches the inside of this node.
    const ggbHostRef = useRef<HTMLDivElement>(null);
    const apiRef = useRef<any>(null);
    const idRef = useRef(`ggb-${Math.random().toString(36).slice(2, 9)}`);

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [expanded, setExpanded] = useState(false);
    const [regenerating, setRegenerating] = useState(false);

    const cmds = useMemo(() => parseCommands(commands), [commands]);

    // ── Init effect: load script → inject applet → run commands ─────────
    useEffect(() => {
        if (typeof window === "undefined" || cmds.length === 0) return;

        let dead = false;
        const id = idRef.current;

        frontendLogger.info('[GGB]', 'effect start', { id, cmdCount: cmds.length, firstCmd: cmds[0] });

        loadGeoGebraScript().then(() => {
            if (dead) { frontendLogger.warn('[GGB]', 'script resolved but dead', { id }); return; }
            const GGBApplet = (window as any).GGBApplet;
            if (!GGBApplet) {
                frontendLogger.error('[GGB]', 'GGBApplet undefined after script load', { id });
                setError("GeoGebra 未正确加载"); setLoading(false); return;
            }

            const el = ggbHostRef.current;
            if (!el) { frontendLogger.warn('[GGB]', 'ggbHostRef null', { id }); return; }

            // D1: GeoGebra's deployggb.js does not resolve width:"100%" against the host —
            // it falls back to a default 500 and the whole frame collapses to height:0.
            // Read the host's real pixel width and pass it as a number.
            const hostW = Math.max(1, el.offsetWidth) || 738;

            // 方案 C+ (dynamic square): use min(hostW, height) as the applet side so the
            // Graphics View is square → with equal coord ranges (x[-6,6] y[-6,6]) the
            // x/y pixel-per-unit is identical, no axis distortion. Matches textbook
            // figure framing; side whitespace is natural for math figures. Adapts to
            // narrow screens (mobile) without hardcoded magic numbers.
            const side = Math.min(hostW, height);

            // Write the inject target directly — React never reconciles this.
            // Center the square applet in the (wider) host with margin:0 auto.
            el.innerHTML = `<div id="${id}" style="width:${side}px;height:${side}px;margin:0 auto"></div>`;
            frontendLogger.info('[GGB]', 'injecting applet', { id, hasGGBApplet: !!GGBApplet, hostW, side });

            try {
                const applet = new GGBApplet({
                    appName: "classic",
                    perspective: "G",      // Graphics View only — skip Algebra View split (core fix for EV height collapse)
                    width: side,
                    height: side,
                    showToolBar,
                    showAlgebraInput,
                    showMenuBar,
                    showResetIcon: true,
                    enableRightClick: true,
                    enableShiftDragZoom: true,
                    language: "zh",
                    appletOnLoad: (api: any) => {
                        if (dead) { frontendLogger.warn('[GGB]', 'appletOnLoad fired but dead', { id }); return; }
                        // D1: force applet pixel size on load — deployggb.js does not honor
                        // width:"100%"/perspective sizing on its own, so the internal frame
                        // chain (applet_scaler → appletParameters → GeoGebraFrame → canvas)
                        // collapses to height:0. setSize() is the official API to fix this.
                        // 方案 C+: square side keeps x/y 1:1.
                        try {
                            if (typeof api.setSize === 'function') {
                                api.setSize(side, side);
                                frontendLogger.info('[GGB]', 'setSize on load', { id, side });
                            }
                        } catch (e) {
                            frontendLogger.warn('[GGB]', 'setSize on load failed', { id, error: String(e) });
                        }
                        // Diagnose canvas dimensions + object existence
                        const hostEl = ggbHostRef.current;
                        const innerEl = hostEl?.firstElementChild as HTMLElement | null;
                        const dims = {
                            hostW: hostEl?.offsetWidth, hostH: hostEl?.offsetHeight,
                            innerW: innerEl?.offsetWidth, innerH: innerEl?.offsetHeight,
                            innerStyleH: innerEl?.style?.height,
                        };
                        // List available api methods (debug which API surface we have)
                        let apiMethods: string[] = [];
                        try { apiMethods = Object.keys(api || {}).filter((k) => typeof api[k] === 'function'); } catch (e) {}
                        // Version check — getViewProperties/getGraphicsOptions need >=6.0
                        let ggbVersion: string | null = null;
                        try { ggbVersion = typeof api.getVersion === 'function' ? api.getVersion() : null; } catch (e) {}
                        frontendLogger.info('[GGB]', 'appletOnLoad fired', { id, hasApi: !!api, dims, apiMethods, ggbVersion });
                        apiRef.current = api;
                        runCommands(api, cmds);
                        // Layer 1: verify objects exist — use getAllObjectNames() dynamically
                        // (hardcoded expected list missed A'/B'/C'/M' transform points)
                        let allNames: string[] = [];
                        try { allNames = typeof api.getAllObjectNames === 'function' ? api.getAllObjectNames() : []; } catch (e) {}
                        const expected = ['O', 'A', 'B', 'C', 't1', 't2', 'lA', 'M'];
                        const existence: Record<string, boolean | string> = {};
                        try {
                            if (typeof api.exists === 'function') {
                                for (const name of expected) existence[name] = api.exists(name);
                                // Also check transform points (apostrophe-named) from allNames
                                const transformPts = allNames.filter((n: string) => n.includes("'"));
                                for (const name of transformPts) existence[name] = api.exists(name);
                            } else {
                                existence['_note'] = 'api.exists not a function';
                            }
                        } catch (e) {}
                        // Test a bare isolated point to see if canvas can render anything at all
                        let testPoint = -1;
                        try {
                            const r = api.evalCommand('(99, 99)');
                            testPoint = r ? 1 : 0;
                        } catch (e) {}
                        frontendLogger.info('[GGB]', 'after runCommands', { id, existence, allNames, testPoint });
                        setLoading(false);
                        frontendLogger.info('[GGB]', 'loading set false after runCommands', { id });
                        // Layer 2/3: official API diagnostics (read-only, after commands settled)
                        let pngBase64: string | null = null;
                        let pngLen = -1;
                        try {
                            if (typeof api.getPNGBase64 === 'function') {
                                pngBase64 = api.getPNGBase64(1, true, 72);
                                pngLen = pngBase64 ? pngBase64.length : 0;
                            }
                        } catch (e) {}
                        let viewProps: any = null, graphicsOpts: any = null, perspXML: string | null = null;
                        try {
                            if (typeof api.getViewProperties === 'function') viewProps = api.getViewProperties(1);
                            if (typeof api.getGraphicsOptions === 'function') graphicsOpts = api.getGraphicsOptions(1);
                            if (typeof api.getPerspectiveXML === 'function') perspXML = api.getPerspectiveXML();
                        } catch (e) {}
                        // 方案 C+ 验收: x/y 等比 → invXscale/invYscale ≈ 1.0
                        // (invXscale = coord units per pixel; equal ranges + square view → equal)
                        // getViewProperties may return a JSON string instead of an object
                        // (observed in production logs), so normalize before computing.
                        let vp: any = viewProps;
                        if (typeof vp === 'string') {
                            try { vp = JSON.parse(vp); } catch (e) { vp = null; }
                        }
                        let axesRatio: number | null = null;
                        let axesOk = false;
                        try {
                            if (vp && typeof vp.invXscale === 'number' && typeof vp.invYscale === 'number' && vp.invYscale !== 0) {
                                axesRatio = vp.invXscale / vp.invYscale;
                                axesOk = Math.abs(axesRatio - 1) < 0.01;
                            }
                        } catch (e) {}
                        frontendLogger.info('[GGB]', 'layer2/3 API diagnostics', {
                            id,
                            pngLen,
                            viewProps,
                            axesRatio,
                            axesOk,
                            graphicsOpts,
                            perspXML: perspXML ? perspXML.slice(0, 300) : null,
                        });
                        // After React re-renders (loading=false) + GeoGebra canvas settles,
                        // walk the actual DOM to find canvas + check computed visibility.
                        const dumpDom = () => {
                            try {
                                const host = ggbHostRef.current;
                                if (!host) { frontendLogger.warn('[GGB]', 'dumpDom: host null', { id }); return; }
                                // Enumerate ALL canvases (querySelector('canvas') grabs the first
                                // which can be the Algebra View inline preview — see experiment A)
                                const canvases = Array.from(host.querySelectorAll('canvas')).map((c, i) => ({
                                    index: i,
                                    width: (c as HTMLCanvasElement).width,
                                    height: (c as HTMLCanvasElement).height,
                                    clientWidth: (c as HTMLElement).clientWidth,
                                    clientHeight: (c as HTMLElement).clientHeight,
                                    parentClass: (c.parentElement?.className || '').toString().slice(0, 60),
                                    grandparentClass: (c.parentElement?.parentElement?.className || '').toString().slice(0, 60),
                                }));
                                // GeoGebraFrame clientWidth/Height — distinguish host h:0 (React/CSS)
                                // vs frame h:0 (GeoGebra internal layout). Also record the
                                // intermediate injected layers (deployggb.js nodes, not our CSS)
                                // so D1 can show where height propagation succeeds/fails.
                                const pick = (sel: string) => {
                                    const n = host.querySelector(sel) as HTMLElement | null;
                                    return n ? { clientWidth: n.clientWidth, clientHeight: n.clientHeight } : null;
                                };
                                const layerDims = {
                                    applet_scaler: pick('.applet_scaler'),
                                    appletParameters: pick('.appletParameters'),
                                    GeoGebraFrame: pick('.GeoGebraFrame'),
                                    EuclidianPanel: pick('.EuclidianPanel'),
                                };
                                const frameDims = layerDims.GeoGebraFrame;
                                const els = host.querySelectorAll('*');
                                const summary: any[] = [];
                                els.forEach((el, i) => {
                                    if (i > 60) return;
                                    const htmlEl = el as HTMLElement;
                                    const tag = htmlEl.tagName.toLowerCase();
                                    const cs = window.getComputedStyle(htmlEl);
                                    const rec = {
                                        tag,
                                        cls: (htmlEl.className || '').toString().slice(0, 40),
                                        display: cs.display,
                                        visibility: cs.visibility,
                                        opacity: cs.opacity,
                                        z: cs.zIndex,
                                        w: htmlEl.offsetWidth,
                                        h: htmlEl.offsetHeight,
                                    };
                                    summary.push(rec);
                                });
                                frontendLogger.info('[GGB]', 'DOM dump', { id, childCount: els.length, canvases, layerDims, sample: summary.slice(0, 15) });
                            } catch (e) {
                                frontendLogger.error('[GGB]', 'dumpDom failed', { id, error: String(e) });
                            }
                        };
                        // Two RAFs: first lets React commit loading=false, second lets GeoGebra layout settle
                        requestAnimationFrame(() => requestAnimationFrame(dumpDom));
                        // Also dump after a longer delay in case canvas loads slowly
                        setTimeout(dumpDom, 1500);
                    },
                }, true);
                // deployggb.js auto-resolves the codebase — do NOT call setHTML5Codebase
                applet.inject(id);
                frontendLogger.info('[GGB]', 'applet.inject called', { id });
            } catch (e) {
                frontendLogger.error('[GGB]', 'Init failed', { id, error: String(e) });
                console.error("[GGB] Init failed:", e);
                if (!dead) { setError("GeoGebra 初始化失败"); setLoading(false); }
            }
        }).catch((e) => {
            frontendLogger.error('[GGB]', 'Script load failed', { id, error: String(e) });
            console.error("[GGB] Script load failed:", e);
            if (!dead) { setError("无法加载 GeoGebra 组件"); setLoading(false); }
        });

        return () => {
            dead = true;
            frontendLogger.info('[GGB]', 'effect cleanup', { id });
            // Cleanup GeoGebra instance to prevent memory leaks
            try {
                const api = apiRef.current;
                if (api && typeof api.remove === 'function') {
                    api.remove();
                }
            } catch (e) {
                frontendLogger.warn('[GGB]', 'Cleanup failed', { id, error: String(e) });
            }
            apiRef.current = null;
            // Clear injected DOM
            if (ggbHostRef.current) {
                ggbHostRef.current.innerHTML = '';
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [cmds, showToolBar, showAlgebraInput, showMenuBar]);

    // ── Resize when expanded toggles ────────────────────────────────────
    useEffect(() => {
        const ggbDiv = ggbHostRef.current?.firstElementChild as HTMLElement | null;
        if (!ggbDiv) return;
        // 方案 C+: keep applet square in both collapsed and expanded states.
        // Expanded uses a larger height budget; side = min(hostW, budget).
        const budget = expanded ? 700 : height;
        const hostW = Math.max(1, ggbHostRef.current?.offsetWidth || 0);
        const side = Math.min(hostW, budget);
        ggbDiv.style.width = `${side}px`;
        ggbDiv.style.height = `${side}px`;
        const api = apiRef.current;
        if (api?.setSize) api.setSize(side, side);
    }, [expanded, height]);

    // ── Reset ───────────────────────────────────────────────────────────
    const handleReset = useCallback(() => {
        const api = apiRef.current;
        if (!api) return;
        try {
            api.resetConstruction();
            setTimeout(() => { if (apiRef.current) runCommands(apiRef.current, cmds); }, 300);
        } catch (e) { console.warn("[GGB] Reset failed", e); }
    }, [cmds]);

    // ── Regenerate ──────────────────────────────────────────────────────
    const handleRegenerate = useCallback(async () => {
        if (!onRegenerate || regenerating) return;
        setRegenerating(true);
        try {
            await onRegenerate();
        } finally {
            setRegenerating(false);
        }
    }, [onRegenerate, regenerating]);

    if (cmds.length === 0) return null;

    return (
        <div className={`relative rounded-lg border bg-card ${className}`}>
            {/* Header */}
            <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/30">
                <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-muted-foreground">
                        GeoGebra 动态演示
                    </span>
                    {loading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
                </div>
                <div className="flex items-center gap-1">
                    {onRegenerate && (
                        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1"
                            onClick={handleRegenerate} title="重新生成" disabled={regenerating || loading}>
                            {regenerating
                                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                : <RefreshCw className="h-3.5 w-3.5" />}
                            <span>重新生成</span>
                        </Button>
                    )}
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0"
                        onClick={handleReset} title="重置" disabled={loading}>
                        <RotateCcw className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0"
                        onClick={() => setExpanded((v) => !v)}
                        title={expanded ? "缩小" : "放大"}>
                        {expanded
                            ? <Minimize2 className="h-3.5 w-3.5" />
                            : <Maximize2 className="h-3.5 w-3.5" />}
                    </Button>
                </div>
            </div>

            {/*
             * GeoGebra container — NO React children inside.
             * The effect writes innerHTML directly, so React never
             * tries to reconcile DOM nodes inside this div.
             */}
            <div ref={ggbHostRef} />

            {/* Loading overlay — sibling, not child of ggbHost */}
            {loading && (
                <div
                    className="absolute inset-0 z-10 flex items-center justify-center bg-background/80 rounded-b-lg"
                    style={{ top: 37 }}
                >
                    <div className="flex flex-col items-center gap-2">
                        <Loader2 className="h-6 w-6 animate-spin text-primary" />
                        <span className="text-sm text-muted-foreground">加载 GeoGebra...</span>
                    </div>
                </div>
            )}

            {/* Error */}
            {error && (
                <div
                    className="flex items-center justify-center text-sm text-destructive"
                    style={{ minHeight: height }}
                >
                    {error}
                </div>
            )}
        </div>
    );
}

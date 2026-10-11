export const GEOGEBRA_PALETTES = {
    'teal-magenta': { label: '蓝绿＋紫红', colors: ['#009E73', '#CC79A7'] },
    'blue-orange': { label: '深蓝＋橙红', colors: ['#0072B2', '#D55E00'] },
    'red-green': { label: '红＋绿', colors: ['#D63031', '#00B894'] },
} as const;

export type GeogebraPalette = keyof typeof GEOGEBRA_PALETTES;
export type GeogebraDisplayMode = 'teaching' | 'print';
export interface GeogebraHighlightGroups {
    primary: readonly string[];
    secondary: readonly string[];
}

export const CIRCUMCENTER_HIGHLIGHTS: GeogebraHighlightGroups = {
    primary: ['segAD', 'segAS', 'segST', 'O', 'D', 'E', 'S'],
    secondary: ['segAO1', 'segHT', 'O_1', 'T'],
};

export function getGeogebraHighlights(itemId: string): GeogebraHighlightGroups | undefined {
    return itemId === 'cmsuhj1ka0001zodb2t0t81wq' ? CIRCUMCENTER_HIGHLIGHTS : undefined;
}

// Only presentation setters are exposed here: applying a mode must never
// rebuild objects, change coordinates, or move the user's graphics view.
export interface GeogebraDisplayApi {
    getAllObjectNames(): string[];
    exists(name: string): boolean;
    getVisible(name: string): boolean;
    getObjectType(name: string): string;
    getColor(name: string): string;
    getLineThickness(name: string): number;
    getPointSize(name: string): number;
    getFilling(name: string): number;
    getGraphicsOptions(view: number): string | Record<string, unknown>;
    setGraphicsOptions(view: number, options: Record<string, unknown>): void;
    setAxesVisible(x: boolean, y: boolean): void;
    setGridVisible(visible: boolean): void;
    setColor(name: string, red: number, green: number, blue: number): void;
    setLineThickness(name: string, thickness: number): void;
    setPointSize(name: string, size: number): void;
    setFilling(name: string, filling: number): void;
    getViewProperties(view: number): string | { width: number };
    getPNGBase64(scale: number, transparent: boolean, dpi: number): string;
}

interface ObjectStyle {
    name: string;
    type: string;
    color: string;
    thickness?: number;
    pointSize?: number;
    filling?: number;
}

export interface GeogebraStyleSnapshot {
    graphics: Record<string, unknown>;
    objects: ObjectStyle[];
}

function setHexColor(api: GeogebraDisplayApi, name: string, color: string) {
    const hex = color.replace('#', '');
    api.setColor(name, parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16));
}

export function captureGeogebraStyles(api: GeogebraDisplayApi): GeogebraStyleSnapshot {
    const raw = api.getGraphicsOptions(1);
    const graphics = JSON.parse(typeof raw === 'string' ? raw : JSON.stringify(raw));
    const objects = api.getAllObjectNames().filter(name => api.getVisible(name)).map(name => {
        const type = api.getObjectType(name);
        const style: ObjectStyle = { name, type, color: api.getColor(name) };
        if (type === 'point') style.pointSize = api.getPointSize(name);
        else if (!['text', 'numeric', 'boolean', 'list'].includes(type)) style.thickness = api.getLineThickness(name);
        const filling = api.getFilling(name);
        if (Number.isFinite(filling) && filling >= 0 && filling <= 1) style.filling = filling;
        return style;
    });
    return { graphics, objects };
}

export function applyGeogebraDisplay(
    api: GeogebraDisplayApi,
    snapshot: GeogebraStyleSnapshot,
    mode: GeogebraDisplayMode,
    palette: GeogebraPalette,
    groups?: GeogebraHighlightGroups,
) {
    const printing = mode === 'print';
    // Restore only graphics options; never reset bounds or the construction.
    api.setGraphicsOptions(1, JSON.parse(JSON.stringify(snapshot.graphics)));
    if (printing) {
        api.setGraphicsOptions(1, { bgColor: '#FFFFFF' });
        api.setAxesVisible(false, false);
        api.setGridVisible(false);
    }
    for (const style of snapshot.objects) {
        if (!api.exists(style.name)) continue;
        setHexColor(api, style.name, printing ? (style.type === 'point' ? '#1E1E1E' : '#282828') : style.color);
        if (style.thickness !== undefined) api.setLineThickness(style.name, printing ? 2 : style.thickness);
        if (style.pointSize !== undefined) api.setPointSize(style.name, printing ? 2 : style.pointSize);
        if (style.filling !== undefined) api.setFilling(style.name, printing ? Math.min(style.filling, 0.12) : style.filling);
    }
    if (!printing && groups) {
        [groups.primary, groups.secondary].forEach((names, index) => {
            for (const name of names) {
                if (api.exists(name)) setHexColor(api, name, GEOGEBRA_PALETTES[palette].colors[index]);
            }
        });
    }
}

export function exportGeogebraPNG(api: GeogebraDisplayApi): string {
    const raw = api.getViewProperties(1);
    const view = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!Number.isFinite(view.width) || view.width <= 0) throw new Error('无法获取绘图区尺寸');
    // Ask GeoGebra to render the graphics view itself at high resolution.
    // Temporarily force white without changing the chosen palette or bounds.
    const options = api.getGraphicsOptions(1);
    const graphics = typeof options === 'string' ? JSON.parse(options) : options;
    try {
        api.setGraphicsOptions(1, { bgColor: '#FFFFFF' });
        const png = api.getPNGBase64(Math.max(1, Math.ceil(2400 / view.width)), false, 300);
        if (!png || !png.startsWith('iVBORw0KGgo')) throw new Error('GeoGebra 未返回有效图片');
        return png;
    } finally {
        api.setGraphicsOptions(1, { bgColor: graphics.bgColor });
    }
}

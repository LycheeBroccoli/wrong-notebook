import { describe, expect, it, vi } from 'vitest';
import {
    applyGeogebraDisplay, captureGeogebraStyles, exportGeogebraPNG,
    CIRCUMCENTER_HIGHLIGHTS, getGeogebraHighlights, type GeogebraDisplayApi,
} from '@/lib/geogebra-display';

function fixture() {
    const objects: Record<string, { type: string; color: string; visible: boolean; thickness: number; size: number; filling: number }> = {
        segAD: { type: 'segment', color: '#009E73', visible: true, thickness: 3, size: 0, filling: 0 },
        segAO1: { type: 'segment', color: '#CC79A7', visible: true, thickness: 4, size: 0, filling: 0 },
        T: { type: 'point', color: '#CC79A7', visible: true, thickness: 0, size: 3, filling: 0 },
        polygon: { type: 'polygon', color: '#123456', visible: true, thickness: 5, size: 0, filling: 0.5 },
        circle: { type: 'conic', color: '#ABCDEF', visible: false, thickness: 2, size: 0, filling: 0 },
    };
    let graphics: Record<string, unknown> = { axes: { x: { visible: true }, y: { visible: false } }, grid: true, bgColor: '#EFEFEF', axesColor: '#111111' };
    const api: GeogebraDisplayApi = {
        getAllObjectNames: () => Object.keys(objects), exists: name => name in objects,
        getVisible: name => objects[name].visible, getObjectType: name => objects[name].type,
        getColor: name => objects[name].color, getLineThickness: name => objects[name].thickness,
        getPointSize: name => objects[name].size, getFilling: name => objects[name].filling,
        getGraphicsOptions: () => JSON.stringify(graphics),
        setGraphicsOptions: vi.fn((_, next) => { graphics = { ...graphics, ...next }; }),
        setAxesVisible: (x, y) => { graphics.axes = { x: { visible: x }, y: { visible: y } }; },
        setGridVisible: show => { graphics.grid = show; },
        setColor: (name, ...rgb) => { objects[name].color = '#' + rgb.map(x => x.toString(16).padStart(2, '0')).join('').toUpperCase(); },
        setLineThickness: (name, thickness) => { objects[name].thickness = thickness; },
        setPointSize: (name, size) => { objects[name].size = size; },
        setFilling: (name, filling) => { objects[name].filling = filling; },
        getViewProperties: () => JSON.stringify({ width: 400 }),
        getPNGBase64: vi.fn(() => 'iVBORw0KGgoAAA'),
    };
    return { api, objects, graphics: () => graphics };
}

describe('GeoGebra display modes', () => {
    it('restores styles and graphics options exactly after repeated print toggles', () => {
        const f = fixture();
        const before = JSON.parse(JSON.stringify(f.objects));
        const graphics = f.graphics();
        const snapshot = captureGeogebraStyles(f.api);
        for (let i = 0; i < 3; i++) {
            applyGeogebraDisplay(f.api, snapshot, 'print', 'teal-magenta');
            expect(f.graphics()).toMatchObject({ axes: { x: { visible: false }, y: { visible: false } }, grid: false, bgColor: '#FFFFFF' });
            expect(f.objects.polygon.filling).toBe(0.12);
            expect(f.objects.T.size).toBe(2);
            expect(f.objects.circle).toEqual(before.circle);
            applyGeogebraDisplay(f.api, snapshot, 'teaching', 'teal-magenta');
            expect(f.objects).toEqual(before);
            expect(f.graphics()).toEqual(graphics);
        }
    });

    it('switches only explicitly configured highlight groups and preserves the selected palette through print', () => {
        const f = fixture();
        const snapshot = captureGeogebraStyles(f.api);
        applyGeogebraDisplay(f.api, snapshot, 'teaching', 'blue-orange', CIRCUMCENTER_HIGHLIGHTS);
        expect(f.objects.segAD.color).toBe('#0072B2');
        expect(f.objects.segAO1.color).toBe('#D55E00');
        expect(f.objects.T.color).toBe('#D55E00');
        expect(f.objects.polygon.color).toBe('#123456');
        applyGeogebraDisplay(f.api, snapshot, 'print', 'blue-orange', CIRCUMCENTER_HIGHLIGHTS);
        expect(f.objects.segAD.color).toBe('#282828');
        applyGeogebraDisplay(f.api, snapshot, 'teaching', 'blue-orange', CIRCUMCENTER_HIGHLIGHTS);
        expect(f.objects.segAD.color).toBe('#0072B2');
        expect(getGeogebraHighlights('other-item')).toBeUndefined();
    });

    it('exports the view at least 2400 pixels wide with white opaque background and 300 DPI, then restores it', () => {
        const f = fixture();
        expect(exportGeogebraPNG(f.api)).toMatch(/^iVBOR/);
        expect(f.api.getPNGBase64).toHaveBeenCalledWith(6, false, 300);
        expect(f.graphics().bgColor).toBe('#EFEFEF');
    });

    it('restores background even when PNG generation fails and rejects empty images', () => {
        const f = fixture();
        f.api.getPNGBase64 = () => { throw new Error('renderer failed'); };
        expect(() => exportGeogebraPNG(f.api)).toThrow('renderer failed');
        expect(f.graphics().bgColor).toBe('#EFEFEF');
        f.api.getPNGBase64 = () => '';
        expect(() => exportGeogebraPNG(f.api)).toThrow('GeoGebra 未返回有效图片');
    });
});

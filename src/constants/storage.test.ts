import { describe, it, expect } from 'vitest';
import { STORAGE_KEYS } from './storage';

describe('STORAGE_KEYS', () => {
    it('all string keys are non-empty strings', () => {
        for (const [key, value] of Object.entries(STORAGE_KEYS)) {
            if (typeof value === 'string') {
                expect(value.length, `STORAGE_KEYS.${key} should not be empty`).toBeGreaterThan(0);
            }
        }
    });

    it('all string keys are unique', () => {
        const values = Object.values(STORAGE_KEYS).filter(v => typeof v === 'string') as string[];
        const unique = new Set(values);
        expect(unique.size).toBe(values.length);
    });

    it('UI_GRID_COL_SIZES factory returns unique keys per column count', () => {
        expect(STORAGE_KEYS.UI_GRID_COL_SIZES(1)).not.toBe(STORAGE_KEYS.UI_GRID_COL_SIZES(2));
        expect(STORAGE_KEYS.UI_GRID_COL_SIZES(3)).toBe('hterm_ui_gridColSizes_3');
    });

    it('UI_GRID_ROW_SIZES factory returns unique keys per row count', () => {
        expect(STORAGE_KEYS.UI_GRID_ROW_SIZES(1)).not.toBe(STORAGE_KEYS.UI_GRID_ROW_SIZES(2));
        expect(STORAGE_KEYS.UI_GRID_ROW_SIZES(4)).toBe('hterm_ui_gridRowSizes_4');
    });

    it('grid size factory keys do not collide with static keys', () => {
        const staticValues = Object.values(STORAGE_KEYS)
            .filter(v => typeof v === 'string') as string[];
        expect(staticValues).not.toContain(STORAGE_KEYS.UI_GRID_COL_SIZES(2));
        expect(staticValues).not.toContain(STORAGE_KEYS.UI_GRID_ROW_SIZES(2));
    });
});

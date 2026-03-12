import { describe, it, expect, beforeEach } from 'vitest';
import { usePaneStore } from './paneStore';

const DEFAULTS = usePaneStore.getState();

beforeEach(() => {
    usePaneStore.setState(DEFAULTS, true);
    localStorage.clear();
});

describe('paneStore — default state', () => {
    it('layoutMode defaults to 1x1', () => {
        expect(usePaneStore.getState().layoutMode).toBe('1x1');
    });
});

describe('paneStore — setLayoutMode', () => {
    it.each([
        ['1x2'],
        ['2x1'],
        ['2x2'],
        ['2x3'],
        ['3x2'],
    ] as const)('sets layoutMode to %s', (mode) => {
        usePaneStore.getState().setLayoutMode(mode);
        expect(usePaneStore.getState().layoutMode).toBe(mode);
    });

    it('can switch between modes multiple times', () => {
        usePaneStore.getState().setLayoutMode('2x2');
        usePaneStore.getState().setLayoutMode('1x1');
        expect(usePaneStore.getState().layoutMode).toBe('1x1');
    });
});

describe('paneStore — persist to localStorage', () => {
    it('writes layoutMode to localStorage under hotty-pane-layout key', () => {
        usePaneStore.getState().setLayoutMode('2x3');
        const stored = JSON.parse(localStorage.getItem('hotty-pane-layout') ?? '{}');
        expect(stored.state.layoutMode).toBe('2x3');
    });
});

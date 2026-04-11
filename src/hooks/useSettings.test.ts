import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSettings } from './useSettings';
import { useSettingsStore } from '../stores/settingsStore';

const DEFAULTS = useSettingsStore.getState();

beforeEach(() => {
    useSettingsStore.setState(DEFAULTS, true);
    localStorage.clear();
});

describe('useSettings — exposes all settings fields', () => {
    it('returns fontSize from the store', () => {
        const { result } = renderHook(() => useSettings());
        expect(result.current.settings.fontSize).toBe(DEFAULTS.fontSize);
    });

    it('returns fontFamily from the store', () => {
        const { result } = renderHook(() => useSettings());
        expect(result.current.settings.fontFamily).toBe(DEFAULTS.fontFamily);
    });

    it('returns theme from the store', () => {
        const { result } = renderHook(() => useSettings());
        expect(result.current.settings.theme).toBe(DEFAULTS.theme);
    });

    it('returns all expected keys in settings', () => {
        const { result } = renderHook(() => useSettings());
        const keys = Object.keys(result.current.settings);
        const expected = [
            'globalEncoding', 'fontSize', 'fontFamily', 'theme',
            'terminalForeground', 'terminalBackground', 'terminalBackgroundInactive',
            'paneBackground', 'paneBackgroundMode', 'paneBackgroundImage', 'customColors',
            'sshKeepAliveEnabled', 'sshKeepAliveInterval',
            'telnetKeepAliveEnabled', 'telnetKeepAliveInterval',
            'loggingEnabled', 'loggingPath', 'lineWrapEnabled', 'scrollback',
            'watchBufferLimit', 'backspaceSendsDel', 'rightClickPaste',
            'showSystemPrompt', 'enablePromptHighlight', 'promptHighlightColor',
            'promptPatterns', 'aiPersonas', 'activePersonaId',
            'sidebarPosition', 'interactiveStabilizationTimeout',
        ];
        expected.forEach(key => expect(keys).toContain(key));
    });
});

describe('useSettings — update functions delegate to store', () => {
    it('updateFontSize updates the store', () => {
        const { result } = renderHook(() => useSettings());
        act(() => result.current.updateFontSize(20));
        expect(useSettingsStore.getState().fontSize).toBe(20);
    });

    it('updateFontFamily updates the store', () => {
        const { result } = renderHook(() => useSettings());
        act(() => result.current.updateFontFamily('monospace'));
        expect(useSettingsStore.getState().fontFamily).toBe('monospace');
    });

    it('updateTheme updates the store', () => {
        const { result } = renderHook(() => useSettings());
        act(() => result.current.updateTheme('light'));
        expect(useSettingsStore.getState().theme).toBe('light');
    });

    it('toggleLineWrap toggles lineWrapEnabled in the store', () => {
        const before = useSettingsStore.getState().lineWrapEnabled;
        const { result } = renderHook(() => useSettings());
        act(() => result.current.toggleLineWrap());
        expect(useSettingsStore.getState().lineWrapEnabled).toBe(!before);
    });

    it('updateScrollback updates the store', () => {
        const { result } = renderHook(() => useSettings());
        act(() => result.current.updateScrollback(5000));
        expect(useSettingsStore.getState().scrollback).toBe(5000);
    });

    it('updateSidebarPosition updates the store', () => {
        const { result } = renderHook(() => useSettings());
        act(() => result.current.updateSidebarPosition('right'));
        expect(useSettingsStore.getState().sidebarPosition).toBe('right');
    });
});

describe('useSettings — reactivity', () => {
    it('settings object reflects store changes on rerender', () => {
        const { result, rerender } = renderHook(() => useSettings());
        act(() => result.current.updateFontSize(24));
        rerender();
        expect(result.current.settings.fontSize).toBe(24);
    });
});

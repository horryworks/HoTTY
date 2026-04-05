import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useSettingsStore } from './settingsStore';

vi.mock('../services/electronService', () => ({
    updateLogging: vi.fn(),
    encryptSecrets: vi.fn(),
    decryptSecrets: vi.fn(),
}));

import * as electronService from '../services/electronService';

// Capture defaults before any test mutates the store
const DEFAULTS = useSettingsStore.getState();

beforeEach(() => {
    useSettingsStore.setState(DEFAULTS, true);
    vi.clearAllMocks();
    localStorage.clear();
});

describe('settingsStore — default state', () => {
    it('has expected default values', () => {
        const s = useSettingsStore.getState();
        expect(s.fontSize).toBe(14);
        expect(s.fontFamily).toBe('Consolas, "Courier New", monospace');
        expect(s.theme).toBe('dark');
        expect(s.globalEncoding).toBe('utf8');
        expect(s.lineWrapEnabled).toBe(true);
        expect(s.scrollback).toBe(10000);
        expect(s.sidebarPosition).toBe('left');
        expect(s.promptPatterns.length).toBeGreaterThan(0);
        expect(s.aiPersonas.length).toBeGreaterThan(0);
        expect(s.aiPersonas[0].askAiCommands.length).toBeGreaterThan(0);
        expect(s.activePersonaId).toBe('network-expert');
        expect(s.activeAiProvider).toBe('vertexai');
    });

    it('updateActiveAiProvider switches between all supported providers', () => {
        useSettingsStore.getState().updateActiveAiProvider('vertexai');
        expect(useSettingsStore.getState().activeAiProvider).toBe('vertexai');
        useSettingsStore.getState().updateActiveAiProvider('openai');
        expect(useSettingsStore.getState().activeAiProvider).toBe('openai');
        useSettingsStore.getState().updateActiveAiProvider('anthropic');
        expect(useSettingsStore.getState().activeAiProvider).toBe('anthropic');
        useSettingsStore.getState().updateActiveAiProvider('gemini');
        expect(useSettingsStore.getState().activeAiProvider).toBe('gemini');
    });
});

describe('settingsStore — simple setters', () => {
    it('updateFontSize', () => {
        useSettingsStore.getState().updateFontSize(18);
        expect(useSettingsStore.getState().fontSize).toBe(18);
    });

    it('updateFontFamily', () => {
        useSettingsStore.getState().updateFontFamily('monospace');
        expect(useSettingsStore.getState().fontFamily).toBe('monospace');
    });

    it('updateTheme', () => {
        useSettingsStore.getState().updateTheme('light');
        expect(useSettingsStore.getState().theme).toBe('light');
    });

    it('updateGlobalEncoding', () => {
        useSettingsStore.getState().updateGlobalEncoding('shift-jis');
        expect(useSettingsStore.getState().globalEncoding).toBe('shift-jis');
    });

    it('updateScrollback', () => {
        useSettingsStore.getState().updateScrollback(5000);
        expect(useSettingsStore.getState().scrollback).toBe(5000);
    });

    it('updateSidebarPosition', () => {
        useSettingsStore.getState().updateSidebarPosition('right');
        expect(useSettingsStore.getState().sidebarPosition).toBe('right');
    });

    it('updateBackspaceSendsDel', () => {
        useSettingsStore.getState().updateBackspaceSendsDel(true);
        expect(useSettingsStore.getState().backspaceSendsDel).toBe(true);
    });

    it('updateRightClickPaste', () => {
        useSettingsStore.getState().updateRightClickPaste(false);
        expect(useSettingsStore.getState().rightClickPaste).toBe(false);
    });

    it('updateEnablePromptHighlight', () => {
        useSettingsStore.getState().updateEnablePromptHighlight(false);
        expect(useSettingsStore.getState().enablePromptHighlight).toBe(false);
    });

    it('updateWatchBufferLimit', () => {
        useSettingsStore.getState().updateWatchBufferLimit(100000);
        expect(useSettingsStore.getState().watchBufferLimit).toBe(100000);
    });
});

describe('settingsStore — toggleLineWrap', () => {
    it('flips lineWrapEnabled from true to false', () => {
        expect(useSettingsStore.getState().lineWrapEnabled).toBe(true);
        useSettingsStore.getState().toggleLineWrap();
        expect(useSettingsStore.getState().lineWrapEnabled).toBe(false);
    });

    it('flips lineWrapEnabled back to true on second toggle', () => {
        useSettingsStore.getState().toggleLineWrap();
        useSettingsStore.getState().toggleLineWrap();
        expect(useSettingsStore.getState().lineWrapEnabled).toBe(true);
    });
});

describe('settingsStore — terminal color updaters', () => {
    it('updateTerminalForeground updates terminalForeground', () => {
        useSettingsStore.getState().updateTheme('dark');
        useSettingsStore.getState().updateTerminalForeground('#aabbcc');
        expect(useSettingsStore.getState().terminalForeground).toBe('#aabbcc');
    });

    it('updateTerminalBackground updates terminalBackground', () => {
        useSettingsStore.getState().updateTheme('light');
        useSettingsStore.getState().updateTerminalBackground('#112233');
        expect(useSettingsStore.getState().terminalBackground).toBe('#112233');
    });

    it('updateTerminalBackgroundInactive updates terminalBackgroundInactive', () => {
        useSettingsStore.getState().updateTerminalBackgroundInactive('#0000ff');
        expect(useSettingsStore.getState().terminalBackgroundInactive).toBe('#0000ff');
    });

    it('updatePaneBackground updates paneBackground', () => {
        useSettingsStore.getState().updatePaneBackground('#123456');
        expect(useSettingsStore.getState().paneBackground).toBe('#123456');
    });
});

describe('settingsStore — logging side effects', () => {
    it('updateLoggingEnabled calls electronService.updateLogging', () => {
        useSettingsStore.getState().updateLoggingEnabled(true);
        expect(electronService.updateLogging).toHaveBeenCalledWith(true, '');
    });

    it('updateLoggingPath calls electronService.updateLogging when loggingEnabled is true', () => {
        useSettingsStore.setState({ loggingEnabled: true });
        useSettingsStore.getState().updateLoggingPath('/var/log/hotty.log');
        expect(electronService.updateLogging).toHaveBeenCalledWith(true, '/var/log/hotty.log');
    });

    it('updateLoggingPath does NOT call electronService.updateLogging when loggingEnabled is false', () => {
        useSettingsStore.setState({ loggingEnabled: false });
        useSettingsStore.getState().updateLoggingPath('/var/log/hotty.log');
        expect(electronService.updateLogging).not.toHaveBeenCalled();
    });

    it('updateLoggingPath does NOT call electronService.updateLogging when path is empty', () => {
        useSettingsStore.setState({ loggingEnabled: true });
        useSettingsStore.getState().updateLoggingPath('');
        expect(electronService.updateLogging).not.toHaveBeenCalled();
    });
});

describe('settingsStore — persist to localStorage', () => {
    it('writes to localStorage under hotty-settings key on state change', () => {
        useSettingsStore.getState().updateFontSize(20);
        const stored = JSON.parse(localStorage.getItem('hotty-settings') ?? '{}');
        expect(stored.state.fontSize).toBe(20);
    });

    it('does not store action functions in localStorage', () => {
        useSettingsStore.getState().updateFontSize(20);
        const stored = JSON.parse(localStorage.getItem('hotty-settings') ?? '{}');
        const keys = Object.keys(stored.state);
        const hasFunctions = keys.some(k => typeof (stored.state as Record<string, unknown>)[k] === 'function');
        expect(hasFunctions).toBe(false);
    });
});

describe('settingsStore — Huawei prompt pattern matches HRP prefixes', () => {
    function getHuaweiRegex(): RegExp {
        const huawei = useSettingsStore.getState().promptPatterns.find(p => p.id === 'huawei');
        return new RegExp(huawei!.pattern);
    }

    it('matches plain user view <hostname>', () => {
        expect(getHuaweiRegex().test('<USG6000>')).toBe(true);
    });

    it('matches plain system view [hostname]', () => {
        expect(getHuaweiRegex().test('[USG6000]')).toBe(true);
    });

    it('matches HRP_M user view', () => {
        expect(getHuaweiRegex().test('HRP_M<FW_A>')).toBe(true);
    });

    it('matches HRP_S user view', () => {
        expect(getHuaweiRegex().test('HRP_S<FW_B>')).toBe(true);
    });

    it('matches HRP_A user view', () => {
        expect(getHuaweiRegex().test('HRP_A<USG_A>')).toBe(true);
    });

    it('matches HRP_B user view', () => {
        expect(getHuaweiRegex().test('HRP_B<USG_B>')).toBe(true);
    });

    it('matches HRP_M system view', () => {
        expect(getHuaweiRegex().test('HRP_M[FW_A]')).toBe(true);
    });

    it('matches HRP_S system view', () => {
        expect(getHuaweiRegex().test('HRP_S[FW_B]')).toBe(true);
    });

    it('matches HRP with sub-view prompt', () => {
        expect(getHuaweiRegex().test('HRP_M[FW_A-security-policy]')).toBe(true);
    });
});

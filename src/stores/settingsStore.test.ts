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
        expect(s.askGeminiCommands.length).toBeGreaterThan(0);
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

describe('settingsStore — terminal color updaters (non-custom theme)', () => {
    it('updateTerminalForeground only updates terminalForeground when theme is not custom', () => {
        useSettingsStore.getState().updateTheme('dark');
        const prevCustom = useSettingsStore.getState().customColors;
        useSettingsStore.getState().updateTerminalForeground('#aabbcc');
        const s = useSettingsStore.getState();
        expect(s.terminalForeground).toBe('#aabbcc');
        expect(s.customColors).toBe(prevCustom); // customColors unchanged
    });

    it('updateTerminalBackground only updates terminalBackground when theme is not custom', () => {
        useSettingsStore.getState().updateTheme('light');
        const prevCustom = useSettingsStore.getState().customColors;
        useSettingsStore.getState().updateTerminalBackground('#112233');
        const s = useSettingsStore.getState();
        expect(s.terminalBackground).toBe('#112233');
        expect(s.customColors).toBe(prevCustom);
    });
});

describe('settingsStore — terminal color updaters (custom theme)', () => {
    beforeEach(() => {
        useSettingsStore.getState().updateTheme('custom');
    });

    it('updateTerminalForeground also updates customColors.foreground', () => {
        useSettingsStore.getState().updateTerminalForeground('#ff0000');
        const s = useSettingsStore.getState();
        expect(s.terminalForeground).toBe('#ff0000');
        expect(s.customColors.foreground).toBe('#ff0000');
    });

    it('updateTerminalBackground also updates customColors.background', () => {
        useSettingsStore.getState().updateTerminalBackground('#00ff00');
        const s = useSettingsStore.getState();
        expect(s.terminalBackground).toBe('#00ff00');
        expect(s.customColors.background).toBe('#00ff00');
    });

    it('updateTerminalBackgroundInactive also updates customColors.backgroundInactive', () => {
        useSettingsStore.getState().updateTerminalBackgroundInactive('#0000ff');
        const s = useSettingsStore.getState();
        expect(s.terminalBackgroundInactive).toBe('#0000ff');
        expect(s.customColors.backgroundInactive).toBe('#0000ff');
    });

    it('updatePaneBackground also updates customColors.paneBackground', () => {
        useSettingsStore.getState().updatePaneBackground('#123456');
        const s = useSettingsStore.getState();
        expect(s.paneBackground).toBe('#123456');
        expect(s.customColors.paneBackground).toBe('#123456');
    });

    it('updating one color does not affect other customColors fields', () => {
        const before = useSettingsStore.getState().customColors;
        useSettingsStore.getState().updateTerminalForeground('#ffffff');
        const after = useSettingsStore.getState().customColors;
        expect(after.background).toBe(before.background);
        expect(after.backgroundInactive).toBe(before.backgroundInactive);
        expect(after.paneBackground).toBe(before.paneBackground);
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
        const hasFunctions = keys.some(k => typeof (stored.state as any)[k] === 'function');
        expect(hasFunctions).toBe(false);
    });
});

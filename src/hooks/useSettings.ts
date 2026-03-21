import { useSettingsStore } from '../stores/settingsStore';
export type { SettingsState } from '../stores/settingsStore';

/**
 * Compatibility wrapper around the Zustand settings store.
 * Returns the same { settings, updateXxx } shape as before,
 * so App.tsx and all consumers need zero changes.
 */
export function useSettings() {
    const store = useSettingsStore();

    const settings = {
        globalEncoding: store.globalEncoding,
        fontSize: store.fontSize,
        fontFamily: store.fontFamily,
        theme: store.theme,
        terminalForeground: store.terminalForeground,
        terminalBackground: store.terminalBackground,
        terminalBackgroundInactive: store.terminalBackgroundInactive,
        paneBackground: store.paneBackground,
        paneBackgroundMode: store.paneBackgroundMode,
        paneBackgroundImage: store.paneBackgroundImage,
        customColors: store.customColors,
        sshKeepAliveEnabled: store.sshKeepAliveEnabled,
        sshKeepAliveInterval: store.sshKeepAliveInterval,
        telnetKeepAliveEnabled: store.telnetKeepAliveEnabled,
        telnetKeepAliveInterval: store.telnetKeepAliveInterval,
        loggingEnabled: store.loggingEnabled,
        loggingPath: store.loggingPath,
        lineWrapEnabled: store.lineWrapEnabled,
        scrollback: store.scrollback,
        watchBufferLimit: store.watchBufferLimit,
        backspaceSendsDel: store.backspaceSendsDel,
        rightClickPaste: store.rightClickPaste,
        showSystemPrompt: store.showSystemPrompt,
        enablePromptHighlight: store.enablePromptHighlight,
        promptHighlightColor: store.promptHighlightColor,
        promptPatterns: store.promptPatterns,
        aiPersonas: store.aiPersonas,
        activePersonaId: store.activePersonaId,
        sidebarPosition: store.sidebarPosition,
        proactiveInstruction: store.proactiveInstruction,
        interactiveStabilizationTimeout: store.interactiveStabilizationTimeout,
        activeAiProvider: store.activeAiProvider,
    };

    return {
        settings,
        updateGlobalEncoding: store.updateGlobalEncoding,
        updateFontSize: store.updateFontSize,
        updateFontFamily: store.updateFontFamily,
        updateTheme: store.updateTheme,
        updateTerminalForeground: store.updateTerminalForeground,
        updateTerminalBackground: store.updateTerminalBackground,
        updateTerminalBackgroundInactive: store.updateTerminalBackgroundInactive,
        updatePaneBackground: store.updatePaneBackground,
        updatePaneBackgroundMode: store.updatePaneBackgroundMode,
        updatePaneBackgroundImage: store.updatePaneBackgroundImage,
        updateSshKeepAliveEnabled: store.updateSshKeepAliveEnabled,
        updateSshKeepAliveInterval: store.updateSshKeepAliveInterval,
        updateTelnetKeepAliveEnabled: store.updateTelnetKeepAliveEnabled,
        updateTelnetKeepAliveInterval: store.updateTelnetKeepAliveInterval,
        updateLoggingEnabled: store.updateLoggingEnabled,
        updateLoggingPath: store.updateLoggingPath,
        toggleLineWrap: store.toggleLineWrap,
        updateScrollback: store.updateScrollback,
        updateWatchBufferLimit: store.updateWatchBufferLimit,
        updateBackspaceSendsDel: store.updateBackspaceSendsDel,
        updateRightClickPaste: store.updateRightClickPaste,
        updateShowSystemPrompt: store.updateShowSystemPrompt,
        updateEnablePromptHighlight: store.updateEnablePromptHighlight,
        updatePromptHighlightColor: store.updatePromptHighlightColor,
        updatePromptPatterns: store.updatePromptPatterns,
        updateAiPersonas: store.updateAiPersonas,
        updateActivePersonaId: store.updateActivePersonaId,
        getActiveAskAiCommands: store.getActiveAskAiCommands,
        updateSidebarPosition: store.updateSidebarPosition,
        updateProactiveInstruction: store.updateProactiveInstruction,
        updateInteractiveStabilizationTimeout: store.updateInteractiveStabilizationTimeout,
        updateActiveAiProvider: store.updateActiveAiProvider,
    };
}

export interface ElectronAPI {
    connectSession: (sessionId: string, config: Record<string, unknown>) => void;
    disconnectSession: (sessionId: string) => void;
    sendInput: (sessionId: string, data: string) => void;
    resize: (sessionId: string, cols: number, rows: number) => void;
    updateSessionEncoding: (sessionId: string, encoding: string) => void;
    setWindowSize: (width: number, height: number) => void;
    writeClipboard: (text: string) => void;
    focusWindow: () => void;

    onSessionData: (callback: (sessionId: string, data: string) => void) => () => void;
    onSessionStatus: (callback: (sessionId: string, status: string) => void) => () => void;
    onSessionError: (callback: (sessionId: string, error: string) => void) => () => void;
    listSerialPorts: () => Promise<{ path: string; manufacturer: string; pnpId: string }[]>;
    selectImage: () => Promise<string | null>;
    selectFolder: () => Promise<string | null>;
    listWslDistributions: () => Promise<string[]>;
    getAppVersion: () => Promise<string>;
    logDebug: (message: string) => void;
    openExternal: (url: string) => void;

    // Gemini AI
    geminiAuthStart: (clientId: string, clientSecret: string) => Promise<boolean>;
    geminiAuthAuto: (clientId: string, clientSecret: string) => Promise<boolean>;
    geminiAuthStatus: () => Promise<boolean>;
    geminiAuthLogout: () => void;
    geminiChatSend: (sessionId: string, message: string, model: string, systemInstruction?: string) => void;
    geminiListModels: () => Promise<{ name: string; displayName: string }[]>;
    geminiChatCancel: (sessionId: string) => void;
    geminiChatClear: (sessionId: string) => void;
    onGeminiAuthResult: (callback: (result: { success: boolean }) => void) => () => void;
    onGeminiChatResponse: (callback: (data: { sessionId: string, type: string, content: string }) => void) => () => void;

    // Context Menu
    showContextMenu: (selection: string, commands?: { id: string; label: string }[], includePaste?: boolean) => void;
    onAskGemini: (callback: (selection: string, type: string) => void) => () => void;
    onTerminalContextPaste: (callback: () => void) => () => void;
    getSshAlgorithms: () => Promise<Record<string, { name: string; enabled: boolean }[]>>;
    saveSshAlgorithms: (algorithms: Record<string, { name: string; enabled: boolean }[]>) => Promise<boolean>;
    getThemes: () => Promise<Record<string, { name?: string; variables?: Record<string, string>; terminal?: Record<string, string> }>>;
    saveCustomTheme: (themeKey: string, themeData: Record<string, unknown>) => Promise<{ success: boolean; error?: string }>;
    deleteCustomTheme: (themeKey: string) => Promise<{ success: boolean; error?: string }>;

    // Host tree import/export
    exportHTree: (data: unknown[], password: string) => Promise<boolean>;
    selectImportFile: () => Promise<string | null>;
    decryptImportFile: (password: string) => Promise<unknown>;
    openDebugLogFolder: () => Promise<void>;

    // Credential encryption (Windows DPAPI)
    encryptSecret: (plaintext: string) => Promise<string>;
    decryptSecret: (ciphertext: string) => Promise<string>;
    encryptSecrets: (plaintexts: (string | undefined)[]) => Promise<(string | undefined)[]>;
    decryptSecrets: (ciphertexts: (string | undefined)[]) => Promise<(string | undefined)[]>;
    updateLogging: (loggingEnabled: boolean, loggingPath: string) => void;
    listLogFiles: (folderPath: string) => Promise<{ files?: { name: string; path: string; mtime: number; size: number }[]; error?: string }>;
    readLogFile: (filePath: string) => Promise<{ content?: string; error?: string }>;
}


declare global {
    interface Window {
        electronAPI: ElectronAPI;
    }
}

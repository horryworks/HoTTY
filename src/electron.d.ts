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
    detectGitBash: () => Promise<{ available: boolean; path?: string }>;
    listSystemFonts: () => Promise<string[]>;
    getAppVersion: () => Promise<string>;
    logDebug: (message: string) => void;
    openExternal: (url: string) => void;

    // AI (provider-agnostic)
    aiAuthStart: (credentials: unknown) => Promise<boolean>;
    aiAuthAuto: (credentials: unknown) => Promise<boolean>;
    aiAuthStatus: () => Promise<boolean>;
    aiAuthLogout: () => void;
    aiChatSend: (sessionId: string, message: string, model: string, systemInstruction?: string) => void;
    aiListModels: () => Promise<{ name: string; displayName: string }[]>;
    aiListLocations: () => Promise<string[]>;
    aiChatCancel: (sessionId: string) => void;
    aiChatClear: (sessionId: string) => void;
    aiListProviders: () => Promise<{ id: string; displayName: string; authType: string }[]>;
    aiSetLocation: (location: string) => Promise<void>;
    aiSetProvider: (providerId: string) => Promise<void>;
    selectServiceAccountKeyFile: () => Promise<string | null>;
    onAiAuthResult: (callback: (result: { success: boolean }) => void) => () => void;
    onAiChatResponse: (callback: (data: { sessionId: string; type: string; content: string; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number } }) => void) => () => void;

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
    verifyUser: (password: string) => Promise<boolean>;
    encryptSecret: (plaintext: string) => Promise<string>;
    decryptSecret: (ciphertext: string) => Promise<string>;
    encryptSecrets: (plaintexts: (string | undefined)[]) => Promise<(string | undefined)[]>;
    decryptSecrets: (ciphertexts: (string | undefined)[]) => Promise<(string | undefined)[]>;
    updateLogging: (loggingEnabled: boolean, loggingPath: string) => void;
    listLogFiles: (folderPath: string) => Promise<{ files?: { name: string; path: string; mtime: number; size: number }[]; error?: string }>;
    readLogFile: (filePath: string) => Promise<{ content?: string; error?: string }>;

    // Ping Monitor
    pingMonitorStart: (sessionId: string, targets: string[], intervalMs: number, loggingEnabled: boolean, loggingPath: string) => void;
    pingMonitorStop: (sessionId: string) => void;
    pingMonitorUpdateTargets: (sessionId: string, targets: string[]) => void;
    pingMonitorUpdateInterval: (sessionId: string, intervalMs: number) => void;
    onPingMonitorData: (callback: (data: { sessionId: string; results: { target: string; status: string; rtt: number | null; ttl: number | null; timestamp: string }[] }) => void) => () => void;
    onPingMonitorLogFile: (callback: (data: { sessionId: string; fileName: string }) => void) => () => void;

    // File Explorer
    fileExplorerListDirectory: (dirPath: string) => Promise<{
        entries?: { name: string; isDirectory: boolean; size: number; mtime: number; isHidden: boolean }[];
        error?: string;
    }>;
    fileExplorerGetDrives: () => Promise<{ drives: string[]; homedir: string }>;

    // Text Editor
    textEditorOpenFile: () => Promise<string | null>;
    textEditorSaveFile: (defaultPath?: string) => Promise<string | null>;
    textEditorReadFile: (filePath: string, encoding: string) => Promise<{ content: string; lineEnding: string }>;
    textEditorWriteFile: (filePath: string, content: string, encoding: string) => Promise<void>;
    textEditorApproveDroppedFile: (filePath: string) => Promise<boolean>;
    getFilePath: (file: File) => string;
    onOpenFileInEditor: (callback: (filePath: string) => void) => () => void;

    // Update notification
    onUpdateAvailable: (callback: (data: { version: string; releaseUrl: string }) => void) => () => void;
}


declare global {
    interface Window {
        electronAPI: ElectronAPI;
    }
}

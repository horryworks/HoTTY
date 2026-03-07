export interface ElectronAPI {
    connectSession: (sessionId: string, config: any) => void;
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
    authorizeMediaPath: (path: string) => Promise<void>;
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
    showContextMenu: (selection: string, commands?: { id: string; label: string }[]) => void;
    onAskGemini: (callback: (selection: string, type: string) => void) => () => void;
    onTerminalContextPaste: (callback: () => void) => () => void;
    getSshAlgorithms: () => Promise<any>;
    saveSshAlgorithms: (algorithms: any) => Promise<boolean>;
    getThemes: () => Promise<any>;
    saveThemes: (themes: any) => Promise<boolean>;

    // Credential encryption (Windows DPAPI)
    encryptSecret: (plaintext: string) => Promise<string>;
    decryptSecret: (ciphertext: string) => Promise<string>;
    encryptSecrets: (plaintexts: (string | undefined)[]) => Promise<(string | undefined)[]>;
    decryptSecrets: (ciphertexts: (string | undefined)[]) => Promise<(string | undefined)[]>;
    updateLogging: (loggingEnabled: boolean, loggingPath: string) => void;
}


declare global {
    interface Window {
        electronAPI: ElectronAPI;
    }
}

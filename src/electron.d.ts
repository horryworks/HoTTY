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
    getAppVersion: () => Promise<string>;

    // Gemini AI
    geminiAuthStart: (clientId: string, clientSecret: string) => Promise<boolean>;
    geminiAuthStatus: () => Promise<boolean>;
    geminiAuthLogout: () => void;
    geminiChatSend: (sessionId: string, message: string, model: string) => void;
    geminiListModels: () => Promise<{ name: string; displayName: string }[]>;
    geminiChatCancel: (sessionId: string) => void;
    geminiChatClear: (sessionId: string) => void;
    onGeminiAuthResult: (callback: (result: { success: boolean }) => void) => () => void;
    onGeminiChatResponse: (callback: (data: { sessionId: string, type: string, content: string }) => void) => () => void;
}

declare global {
    interface Window {
        electronAPI: ElectronAPI;
    }
}

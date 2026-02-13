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
}

declare global {
    interface Window {
        electronAPI: ElectronAPI;
    }
}

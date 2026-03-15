import { vi, describe, it, expect, beforeEach } from 'vitest';
import {
    connectSession,
    disconnectSession,
    sendInput,
    resize,
    writeClipboard,
    logDebug,
    geminiChatSend,
    encryptSecret,
} from './electronService';

const mockAPI = {
    connectSession: vi.fn(),
    disconnectSession: vi.fn(),
    sendInput: vi.fn(),
    resize: vi.fn(),
    updateSessionEncoding: vi.fn(),
    setWindowSize: vi.fn(),
    writeClipboard: vi.fn(),
    focusWindow: vi.fn(),
    onSessionData: vi.fn(),
    onSessionStatus: vi.fn(),
    onSessionError: vi.fn(),
    listSerialPorts: vi.fn(),
    selectImage: vi.fn(),
    selectFolder: vi.fn(),
    getAppVersion: vi.fn(),
    logDebug: vi.fn(),
    openExternal: vi.fn(),
    geminiAuthStart: vi.fn(),
    geminiAuthAuto: vi.fn(),
    geminiAuthStatus: vi.fn(),
    geminiAuthLogout: vi.fn(),
    geminiChatSend: vi.fn(),
    geminiListModels: vi.fn(),
    geminiChatCancel: vi.fn(),
    geminiChatClear: vi.fn(),
    onGeminiAuthResult: vi.fn(),
    onGeminiChatResponse: vi.fn(),
    showContextMenu: vi.fn(),
    onAskGemini: vi.fn(),
    onTerminalContextPaste: vi.fn(),
    getSshAlgorithms: vi.fn(),
    saveSshAlgorithms: vi.fn(),
    getThemes: vi.fn(),
    saveCustomTheme: vi.fn(),
    deleteCustomTheme: vi.fn(),
    encryptSecret: vi.fn(),
    decryptSecret: vi.fn(),
    encryptSecrets: vi.fn(),
    decryptSecrets: vi.fn(),
    updateLogging: vi.fn(),
    listLogFiles: vi.fn(),
    readLogFile: vi.fn(),
    openDebugLogFolder: vi.fn(),
};

beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, 'electronAPI', { value: mockAPI, configurable: true, writable: true });
});

describe('electronService', () => {
    describe('connectSession', () => {
        it('calls api().connectSession with the correct arguments', () => {
            const sessionId = 'session-1';
            const config = { host: 'localhost', port: 22 };
            connectSession(sessionId, config);
            expect(mockAPI.connectSession).toHaveBeenCalledOnce();
            expect(mockAPI.connectSession).toHaveBeenCalledWith(sessionId, config);
        });

        it('passes through the return value', () => {
            const returnValue = { ok: true };
            mockAPI.connectSession.mockReturnValue(returnValue);
            const result = connectSession('s1', {});
            expect(result).toBe(returnValue);
        });
    });

    describe('disconnectSession', () => {
        it('calls api().disconnectSession with the correct session ID', () => {
            disconnectSession('session-2');
            expect(mockAPI.disconnectSession).toHaveBeenCalledOnce();
            expect(mockAPI.disconnectSession).toHaveBeenCalledWith('session-2');
        });

        it('passes through the return value', () => {
            mockAPI.disconnectSession.mockReturnValue(undefined);
            const result = disconnectSession('s2');
            expect(result).toBeUndefined();
        });
    });

    describe('sendInput', () => {
        it('calls api().sendInput with the correct arguments', () => {
            sendInput('session-3', 'ls -la\n');
            expect(mockAPI.sendInput).toHaveBeenCalledOnce();
            expect(mockAPI.sendInput).toHaveBeenCalledWith('session-3', 'ls -la\n');
        });

        it('passes through the return value', () => {
            mockAPI.sendInput.mockReturnValue(42);
            const result = sendInput('s3', 'data');
            expect(result).toBe(42);
        });
    });

    describe('resize', () => {
        it('calls api().resize with sessionId, cols, and rows', () => {
            resize('session-4', 120, 40);
            expect(mockAPI.resize).toHaveBeenCalledOnce();
            expect(mockAPI.resize).toHaveBeenCalledWith('session-4', 120, 40);
        });

        it('passes through the return value', () => {
            mockAPI.resize.mockReturnValue(true);
            const result = resize('s4', 80, 24);
            expect(result).toBe(true);
        });
    });

    describe('writeClipboard', () => {
        it('calls api().writeClipboard with the correct text', () => {
            writeClipboard('hello clipboard');
            expect(mockAPI.writeClipboard).toHaveBeenCalledOnce();
            expect(mockAPI.writeClipboard).toHaveBeenCalledWith('hello clipboard');
        });

        it('passes through the return value', () => {
            mockAPI.writeClipboard.mockReturnValue(undefined);
            const result = writeClipboard('text');
            expect(result).toBeUndefined();
        });
    });

    describe('logDebug', () => {
        it('calls api().logDebug with the correct message', () => {
            logDebug('debug message');
            expect(mockAPI.logDebug).toHaveBeenCalledOnce();
            expect(mockAPI.logDebug).toHaveBeenCalledWith('debug message');
        });

        it('passes through the return value', () => {
            mockAPI.logDebug.mockReturnValue(undefined);
            const result = logDebug('msg');
            expect(result).toBeUndefined();
        });
    });

    describe('geminiChatSend', () => {
        it('calls api().geminiChatSend with all four arguments including systemInstruction', () => {
            geminiChatSend('session-5', 'What is the CPU usage?', 'gemini-pro', 'You are a helpful assistant.');
            expect(mockAPI.geminiChatSend).toHaveBeenCalledOnce();
            expect(mockAPI.geminiChatSend).toHaveBeenCalledWith(
                'session-5',
                'What is the CPU usage?',
                'gemini-pro',
                'You are a helpful assistant.'
            );
        });

        it('calls api().geminiChatSend with undefined systemInstruction when omitted', () => {
            geminiChatSend('session-6', 'Hello', 'gemini-flash');
            expect(mockAPI.geminiChatSend).toHaveBeenCalledOnce();
            expect(mockAPI.geminiChatSend).toHaveBeenCalledWith('session-6', 'Hello', 'gemini-flash', undefined);
        });

        it('passes through the return value', () => {
            const promise = Promise.resolve({ text: 'response' });
            mockAPI.geminiChatSend.mockReturnValue(promise);
            const result = geminiChatSend('s5', 'msg', 'model');
            expect(result).toBe(promise);
        });
    });

    describe('encryptSecret', () => {
        it('calls api().encryptSecret with the correct plaintext', () => {
            encryptSecret('my-secret-password');
            expect(mockAPI.encryptSecret).toHaveBeenCalledOnce();
            expect(mockAPI.encryptSecret).toHaveBeenCalledWith('my-secret-password');
        });

        it('passes through the encrypted return value', () => {
            const encrypted = 'AQIAAA...base64ciphertext';
            mockAPI.encryptSecret.mockReturnValue(encrypted);
            const result = encryptSecret('plaintext');
            expect(result).toBe(encrypted);
        });
    });
});

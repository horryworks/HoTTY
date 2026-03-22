/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
function domReady(condition: DocumentReadyState[] = ['complete', 'interactive']) {
    return new Promise((resolve) => {
        if (condition.includes(document.readyState)) {
            resolve(true)
        } else {
            document.addEventListener('readystatechange', () => {
                if (condition.includes(document.readyState)) {
                    resolve(true)
                }
            })
        }
    })
}

const safeDOM = {
    append(parent: HTMLElement, child: HTMLElement) {
        if (!Array.from(parent.children).find(e => e === child)) {
            return parent.appendChild(child)
        }
    },
    remove(parent: HTMLElement, child: HTMLElement) {
        if (Array.from(parent.children).find(e => e === child)) {
            return parent.removeChild(child)
        }
    },
}

/**
 * https://tobiasahlin.com/spinkit
 * https://connoratherton.com/loaders
 * https://projects.lukehaas.me/css-loaders
 * https://matejkustec.github.io/SpinThatShit
 */
function createLoading() {
    const className = `loaders-css__square-spin`
    const styleContent = `
@keyframes square-spin {
  25% { transform: perspective(100px) rotateX(180deg) rotateY(0); }
  50% { transform: perspective(100px) rotateX(180deg) rotateY(180deg); }
  75% { transform: perspective(100px) rotateX(0) rotateY(180deg); }
  100% { transform: perspective(100px) rotateX(0) rotateY(0); }
}
.${className} > div {
  animation-fill-mode: both;
  width: 50px;
  height: 50px;
  background: #fff;
  animation: square-spin 3s 0s cubic-bezier(0.09, 0.57, 0.49, 0.9) infinite;
}
.app-loading-wrap {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #282c34;
  z-index: 9;
}
    `
    const oStyle = document.createElement('style')
    const oDiv = document.createElement('div')

    oStyle.id = 'app-loading-style'
    oStyle.textContent = styleContent
    oDiv.className = 'app-loading-wrap'
    const oInner = document.createElement('div')
    oInner.className = className
    oInner.appendChild(document.createElement('div'))
    oDiv.appendChild(oInner)

    return {
        appendLoading() {
            safeDOM.append(document.head, oStyle)
            safeDOM.append(document.body, oDiv)
        },
        removeLoading() {
            safeDOM.remove(document.head, oStyle)
            safeDOM.remove(document.body, oDiv)
        },
    }
}

// ----------------------------------------------------------------------

import { contextBridge, ipcRenderer, webUtils } from 'electron'

const { appendLoading, removeLoading } = createLoading()
domReady().then(appendLoading)

window.onmessage = (ev) => {
    if (ev.data.payload === 'removeLoading') removeLoading()
}

setTimeout(removeLoading, 4999)

contextBridge.exposeInMainWorld('electronAPI', {
    connectSession: (sessionId: string, config: Record<string, unknown>) => ipcRenderer.send('connect-session', { sessionId, config }),
    disconnectSession: (sessionId: string) => ipcRenderer.send('disconnect-session', sessionId),
    sendInput: (sessionId: string, data: string) => ipcRenderer.send('term-input', { sessionId, data }),
    resize: (sessionId: string, cols: number, rows: number) => ipcRenderer.send('term-resize', { sessionId, cols, rows }),
    updateSessionEncoding: (sessionId: string, encoding: string) => ipcRenderer.send('update-session-encoding', { sessionId, encoding }),
    setWindowSize: (width: number, height: number) => ipcRenderer.send('set-window-size', { width, height }),
    writeClipboard: (text: string) => ipcRenderer.send('write-clipboard', text),
    focusWindow: () => ipcRenderer.send('focus-window'),
    listSerialPorts: () => ipcRenderer.invoke('list-serial-ports'),
    selectImage: () => ipcRenderer.invoke('select-image'),
    selectFolder: () => ipcRenderer.invoke('select-folder'),
    listWslDistributions: () => ipcRenderer.invoke('list-wsl-distributions'),
    listSystemFonts: () => ipcRenderer.invoke('list-system-fonts'),
    getAppVersion: () => ipcRenderer.invoke('get-app-version'),
    logDebug: (message: string) => ipcRenderer.send('log-debug', message),
    openExternal: (url: string) => ipcRenderer.send('open-external', url),

    showContextMenu: (selection: string, commands?: { id: string; label: string }[], includePaste?: boolean) => ipcRenderer.send('show-context-menu', selection, commands, includePaste),
    onAskGemini: (callback: (selection: string, type: string) => void) => {
        const subscription = (_event: unknown, selection: string, type: string) => callback(selection, type);
        ipcRenderer.on('ask-gemini', subscription);
        return () => ipcRenderer.removeListener('ask-gemini', subscription);
    },
    onTerminalContextPaste: (callback: () => void) => {
        const subscription = () => callback();
        ipcRenderer.on('terminal-context-paste', subscription);
        return () => ipcRenderer.removeListener('terminal-context-paste', subscription);
    },

    // New Event Listeners
    onSessionData: (callback: (sessionId: string, data: string) => void) => {
        const subscription = (_event: unknown, { sessionId, data }: { sessionId: string, data: string }) => callback(sessionId, data);
        ipcRenderer.on('session-data', subscription);
        return () => ipcRenderer.removeListener('session-data', subscription);
    },
    onSessionStatus: (callback: (sessionId: string, status: string) => void) => {
        const subscription = (_event: unknown, { sessionId, status }: { sessionId: string, status: string }) => callback(sessionId, status);
        ipcRenderer.on('session-status', subscription);
        return () => ipcRenderer.removeListener('session-status', subscription);
    },
    onSessionError: (callback: (sessionId: string, error: string) => void) => {
        const subscription = (_event: unknown, { sessionId, error }: { sessionId: string, error: string }) => callback(sessionId, error);
        ipcRenderer.on('session-error', subscription);
        return () => ipcRenderer.removeListener('session-error', subscription);
    },

    // Deprecated single-session methods (shimmed or removed)
    // We strictly move to session-based but keep types valid if needed. 
    // Ideally we remove them.

    // AI (provider-agnostic) - new channels
    aiAuthStart: (credentials: unknown) => ipcRenderer.invoke('ai-auth-start', { credentials }),
    aiAuthAuto: (credentials: unknown) => ipcRenderer.invoke('ai-auth-auto', { credentials }),
    aiAuthStatus: () => ipcRenderer.invoke('ai-auth-status'),
    aiAuthLogout: () => ipcRenderer.send('ai-auth-logout'),
    aiChatSend: (sessionId: string, message: string, model: string, systemInstruction?: string) => ipcRenderer.send('ai-chat-send', { sessionId, message, model, systemInstruction }),
    aiListModels: () => ipcRenderer.invoke('ai-list-models'),
    aiListLocations: () => ipcRenderer.invoke('ai-list-locations'),
    aiChatCancel: (sessionId: string) => ipcRenderer.send('ai-chat-cancel', sessionId),
    aiChatClear: (sessionId: string) => ipcRenderer.send('ai-chat-clear', sessionId),
    aiListProviders: () => ipcRenderer.invoke('ai-list-providers'),
    aiSetLocation: (location: string) => ipcRenderer.invoke('ai-set-location', location),
    aiSetProvider: (providerId: string) => ipcRenderer.invoke('ai-set-provider', providerId),
    selectServiceAccountKeyFile: () => ipcRenderer.invoke('select-service-account-key-file'),
    onAiAuthResult: (callback: (result: { success: boolean }) => void) => {
        const subscription = (_event: unknown, result: { success: boolean }) => callback(result);
        ipcRenderer.on('ai-auth-result', subscription);
        return () => ipcRenderer.removeListener('ai-auth-result', subscription);
    },
    onAiChatResponse: (callback: (data: { sessionId: string, type: string, content: string, usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number } }) => void) => {
        const subscription = (_event: unknown, data: { sessionId: string, type: string, content: string, usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number } }) => callback(data);
        ipcRenderer.on('ai-chat-response', subscription);
        return () => ipcRenderer.removeListener('ai-chat-response', subscription);
    },

    getSshAlgorithms: () => ipcRenderer.invoke('get-ssh-algorithms'),
    saveSshAlgorithms: (algorithms: Record<string, { name: string; enabled: boolean }[]>) => ipcRenderer.invoke('save-ssh-algorithms', algorithms),
    getThemes: () => ipcRenderer.invoke('get-themes'),
    saveCustomTheme: (themeKey: string, themeData: Record<string, unknown>) => ipcRenderer.invoke('save-custom-theme', themeKey, themeData),
    deleteCustomTheme: (themeKey: string) => ipcRenderer.invoke('delete-custom-theme', themeKey),
    verifyUser: (password: string) => ipcRenderer.invoke('dpapi-verify-user', password),
    encryptSecret: (plaintext: string) => ipcRenderer.invoke('dpapi-encrypt', plaintext),
    decryptSecret: (ciphertext: string) => ipcRenderer.invoke('dpapi-decrypt', ciphertext),
    encryptSecrets: (plaintexts: (string | undefined)[]) => ipcRenderer.invoke('dpapi-encrypt-batch', plaintexts),
    decryptSecrets: (ciphertexts: (string | undefined)[]) => ipcRenderer.invoke('dpapi-decrypt-batch', ciphertexts),
    updateLogging: (loggingEnabled: boolean, loggingPath: string) => ipcRenderer.send('update-logging', { loggingEnabled, loggingPath }),
    listLogFiles: (folderPath: string) => ipcRenderer.invoke('list-log-files', folderPath),
    readLogFile: (filePath: string) => ipcRenderer.invoke('read-log-file', filePath),
    exportHTree: (data: unknown[], password: string) => ipcRenderer.invoke('export-htree', { data, password }),
    selectImportFile: () => ipcRenderer.invoke('select-import-file'),
    decryptImportFile: (password: string) => ipcRenderer.invoke('decrypt-import-file', { password }),
    openDebugLogFolder: () => ipcRenderer.invoke('open-debug-log-folder'),

    // Text Editor
    textEditorOpenFile: () => ipcRenderer.invoke('text-editor-open-file'),
    textEditorSaveFile: (defaultPath?: string) => ipcRenderer.invoke('text-editor-save-file', defaultPath),
    textEditorReadFile: (filePath: string, encoding: string) => ipcRenderer.invoke('text-editor-read-file', filePath, encoding),
    textEditorWriteFile: (filePath: string, content: string, encoding: string) => ipcRenderer.invoke('text-editor-write-file', filePath, content, encoding),
    getFilePath: (file: File) => webUtils.getPathForFile(file),
    onOpenFileInEditor: (callback: (filePath: string) => void) => {
        const subscription = (_event: unknown, filePath: string) => callback(filePath);
        ipcRenderer.on('open-file-in-editor', subscription);
        return () => { ipcRenderer.removeListener('open-file-in-editor', subscription); };
    },

    // Ping Monitor
    pingMonitorStart: (sessionId: string, targets: string[], intervalMs: number, loggingEnabled: boolean, loggingPath: string) =>
        ipcRenderer.send('ping-monitor-start', { sessionId, targets, intervalMs, loggingEnabled, loggingPath }),
    pingMonitorStop: (sessionId: string) => ipcRenderer.send('ping-monitor-stop', sessionId),
    pingMonitorUpdateTargets: (sessionId: string, targets: string[]) =>
        ipcRenderer.send('ping-monitor-update-targets', { sessionId, targets }),
    pingMonitorUpdateInterval: (sessionId: string, intervalMs: number) =>
        ipcRenderer.send('ping-monitor-update-interval', { sessionId, intervalMs }),
    onPingMonitorData: (callback: (data: { sessionId: string; results: { target: string; status: string; rtt: number | null; ttl: number | null; timestamp: string }[] }) => void) => {
        const subscription = (_event: unknown, data: { sessionId: string; results: { target: string; status: string; rtt: number | null; ttl: number | null; timestamp: string }[] }) => callback(data);
        ipcRenderer.on('ping-monitor-data', subscription);
        return () => ipcRenderer.removeListener('ping-monitor-data', subscription);
    },
    onPingMonitorLogFile: (callback: (data: { sessionId: string; fileName: string }) => void) => {
        const subscription = (_event: unknown, data: { sessionId: string; fileName: string }) => callback(data);
        ipcRenderer.on('ping-monitor-log-file', subscription);
        return () => ipcRenderer.removeListener('ping-monitor-log-file', subscription);
    },

    onUpdateAvailable: (callback: (data: { version: string; releaseUrl: string }) => void) => {
        const subscription = (_event: unknown, data: { version: string; releaseUrl: string }) => callback(data);
        ipcRenderer.on('update-available', subscription);
        return () => ipcRenderer.removeListener('update-available', subscription);
    },
})



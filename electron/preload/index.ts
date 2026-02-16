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
function useLoading() {
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
    oStyle.innerHTML = styleContent
    oDiv.className = 'app-loading-wrap'
    oDiv.innerHTML = `<div class="${className}"><div></div></div>`

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

// ... existing code ...

import { contextBridge, ipcRenderer } from 'electron'

// ... existing code ...

const { appendLoading, removeLoading } = useLoading()
domReady().then(appendLoading)

window.onmessage = (ev) => {
    ev.data.payload === 'removeLoading' && removeLoading()
}

setTimeout(removeLoading, 4999)

contextBridge.exposeInMainWorld('electronAPI', {
    connectSession: (sessionId: string, config: any) => ipcRenderer.send('connect-session', { sessionId, config }),
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
    authorizeMediaPath: (path: string) => ipcRenderer.invoke('authorize-media-path', path),
    getAppVersion: () => ipcRenderer.invoke('get-app-version'),
    logDebug: (message: string) => ipcRenderer.send('log-debug', message),

    showContextMenu: (selection: string, commands?: { id: string; label: string }[]) => ipcRenderer.send('show-context-menu', selection, commands),
    onAskGemini: (callback: (selection: string, type: string) => void) => {
        const subscription = (_: any, selection: string, type: string) => callback(selection, type);
        ipcRenderer.on('ask-gemini', subscription);
        return () => ipcRenderer.removeListener('ask-gemini', subscription);
    },

    // New Event Listeners
    onSessionData: (callback: (sessionId: string, data: string) => void) => {
        const subscription = (_: any, { sessionId, data }: { sessionId: string, data: string }) => callback(sessionId, data);
        ipcRenderer.on('session-data', subscription);
        return () => ipcRenderer.removeListener('session-data', subscription);
    },
    onSessionStatus: (callback: (sessionId: string, status: string) => void) => {
        const subscription = (_: any, { sessionId, status }: { sessionId: string, status: string }) => callback(sessionId, status);
        ipcRenderer.on('session-status', subscription);
        return () => ipcRenderer.removeListener('session-status', subscription);
    },
    onSessionError: (callback: (sessionId: string, error: string) => void) => {
        const subscription = (_: any, { sessionId, error }: { sessionId: string, error: string }) => callback(sessionId, error);
        ipcRenderer.on('session-error', subscription);
        return () => ipcRenderer.removeListener('session-error', subscription);
    },

    // Deprecated single-session methods (shimmed or removed)
    // We strictly move to session-based but keep types valid if needed. 
    // Ideally we remove them.

    // Gemini AI
    geminiAuthStart: (clientId: string, clientSecret: string) => ipcRenderer.invoke('gemini-auth-start', { clientId, clientSecret }),
    geminiAuthStatus: () => ipcRenderer.invoke('gemini-auth-status'),
    geminiAuthLogout: () => ipcRenderer.send('gemini-auth-logout'),
    geminiChatSend: (sessionId: string, message: string, model: string, systemInstruction?: string) => ipcRenderer.send('gemini-chat-send', { sessionId, message, model, systemInstruction }),
    geminiListModels: () => ipcRenderer.invoke('gemini-list-models'),
    geminiChatCancel: (sessionId: string) => ipcRenderer.send('gemini-chat-cancel', sessionId),
    geminiChatClear: (sessionId: string) => ipcRenderer.send('gemini-chat-clear', sessionId),
    onGeminiAuthResult: (callback: (result: { success: boolean }) => void) => {
        const subscription = (_: any, result: { success: boolean }) => callback(result);
        ipcRenderer.on('gemini-auth-result', subscription);
        return () => ipcRenderer.removeListener('gemini-auth-result', subscription);
    },
    onGeminiChatResponse: (callback: (data: { sessionId: string, type: string, content: string }) => void) => {
        const subscription = (_: any, data: { sessionId: string, type: string, content: string }) => callback(data);
        ipcRenderer.on('gemini-chat-response', subscription);
        return () => ipcRenderer.removeListener('gemini-chat-response', subscription);
    },
})


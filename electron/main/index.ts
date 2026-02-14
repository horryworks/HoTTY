import { app, BrowserWindow, shell, ipcMain, dialog, Menu, MenuItem } from 'electron';
import { release } from 'node:os';
import { join } from 'node:path';
import { SshService } from './services/ssh';
import { TelnetService } from './services/telnet';
import { SerialService } from './services/serial';
import { SerialPort } from 'serialport';
import type { ISessionService } from './services/ISessionService';
import { GeminiService } from './services/gemini';
import { LogManager } from './services/LogManager';

// Disable GPU Acceleration for Windows 7
if (release().startsWith('6.1')) app.disableHardwareAcceleration()

// Set application name for Windows 10+ notifications
if (process.platform === 'win32') app.setAppUserModelId(app.getName())

if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}

let win: BrowserWindow | null = null
let geminiService: GeminiService | null = null;
const logManager = new LogManager();

const preload = join(__dirname, '../preload/index.js')
const url = process.env.VITE_DEV_SERVER_URL
const indexHtml = join(process.env.DIST || 'dist', 'index.html')

const allowedMediaPaths = new Set<string>();

async function createWindow() {
  win = new BrowserWindow({
    title: 'HoTTY',
    // If dev env, assume public/favicon.ico. If prod, assume dist/favicon.ico
    icon: join(process.env.PUBLIC || 'public', 'icon.png'),
    width: 1200,
    height: 800,
    webPreferences: {
      preload,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
    backgroundColor: '#1e1e1e',
  })

  // Hide menu bar
  win.setMenuBarVisibility(false)

  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(indexHtml)
  }

  // Make all links open with the browser, not with the application
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:')) shell.openExternal(url)
    return { action: 'deny' }
  })
}

app.whenReady().then(() => {
  createWindow();
  geminiService = new GeminiService(win!);

  // Register 'media' protocol to serve local files
  const { protocol } = require('electron');
  protocol.registerFileProtocol('media', (request: Electron.ProtocolRequest, callback: (response: string | Electron.ProtocolResponse) => void) => {
    let url = request.url.replace(/^media:\/\//, '');
    // If 3 slashes were used 'media:///C:/...', we now have '/C:/...'
    // On Windows, we want 'C:/...'
    if (process.platform === 'win32' && url.startsWith('/') && /^[a-zA-Z]:/.test(url.slice(1))) {
      url = url.slice(1);
    }

    try {
      const decodedPath = decodeURIComponent(url);
      const normalizedPath = join(decodedPath); // Basic normalization

      // Security Check: Only allow paths that were explicitly selected via dialog
      // This prevents path traversal into system files.
      if (!allowedMediaPaths.has(normalizedPath)) {
        console.warn('Blocked unauthorized media protocol access:', normalizedPath);
        return callback({ error: -6 }); // net::ERR_FILE_NOT_FOUND or similar
      }

      return callback(normalizedPath);
    } catch (error) {
      console.error('Failed to register protocol', error);
      return callback({ error: -2 }); // net::ERR_FAILED
    }
  });
});

app.on('window-all-closed', () => {
  win = null
  if (process.platform !== 'darwin') app.quit()
})

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore()
    win.focus()
  }
})

app.on('activate', () => {
  const allWindows = BrowserWindow.getAllWindows()
  if (allWindows.length) {
    allWindows[0].focus()
  } else {
    createWindow()
  }
})

// IPC Handlers
// IPC Handlers
import * as fs from 'fs';
const debugLogPath = join(app.getPath('userData'), 'debug_gemini.log');

ipcMain.on('log-debug', (_, message) => {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}\n`;
  console.log(logMessage);
  fs.appendFile(debugLogPath, logMessage, (err) => {
    if (err) console.error('Failed to write request log', err);
  });
});

// IPC Handlers
ipcMain.handle('open-win', (_, arg) => {
  // Input validation for 'arg' (hash)
  if (typeof arg !== 'string' || !/^[a-zA-Z0-9_-]*$/.test(arg)) {
    console.error('Invalid window hash argument:', arg);
    return;
  }

  const childWindow = new BrowserWindow({
    webPreferences: {
      preload,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    childWindow.loadURL(`${process.env.VITE_DEV_SERVER_URL}#${arg}`)
  } else {
    childWindow.loadFile(indexHtml, { hash: arg })
  }
})

// Session Management
interface Session {
  id: string;
  type: 'ssh' | 'telnet' | 'serial';
  service: ISessionService;
}

const sessions = new Map<string, Session>();

ipcMain.on('connect-session', async (event, { sessionId, config }) => {
  if (!win) return;

  // Cleanup existing if reusing ID (shouldn't happen with UUIDs but good safety)
  if (sessions.has(sessionId)) {
    const oldSession = sessions.get(sessionId)!;
    oldSession.service.disconnect();
    sessions.delete(sessionId);
  }

  const protocol = config.protocol || 'ssh';
  let service: ISessionService;

  if (protocol === 'ssh') {
    service = new SshService(win, sessionId);
  } else if (protocol === 'telnet') {
    service = new TelnetService(win, sessionId);
  } else {
    service = new SerialService(win, sessionId);
  }

  sessions.set(sessionId, {
    id: sessionId,
    type: protocol,
    service: service
  });

  // We need to proxy the service events to include sessionId
  // However, the services send events directly to 'ssh-status', 'term-data', 'ssh-error'
  // We need to change services to return data so we can wrap it, 
  // OR we can change the IPC channel names in the services?
  // Easier approach: wrapper in main process that intercepts specific events? 
  // No, `SshService` takes `win` and sends directly.

  // Modification needed in SshService/TelnetService: pass sessionId to them?
  // Or handle event routing here.
  // Let's modify services to accept an event emitter or callback, OR just pass sessionId to them
  // and have them include it in the payload.

  // For now, let's assume we will modify SshService/TelnetService to accept sessionId and include it.

  // WAIT: I can't easily modify SshService constructor calls without modifying SshService first.
  // Strategy: I will modify SshService and TelnetService to accept `sessionId` in constructor 
  // and send `{ sessionId, data }` in their IPC events.

  // Start logging if enabled
  logManager.startLogging(sessionId, config);

  // Subscribe to data events for logging
  service.onData((data) => {
    logManager.write(sessionId, data);
  });

  await service.connect(config);
});

ipcMain.on('term-input', (event, { sessionId, data }) => {
  const session = sessions.get(sessionId);
  if (session) {
    session.service.write(data);
  }
});

ipcMain.on('term-resize', (event, { sessionId, cols, rows }) => {
  const session = sessions.get(sessionId);
  if (session) {
    session.service.resize(cols, rows);
  }
});

ipcMain.on('set-window-size', (event, { width, height }) => {
  if (win) {
    win.setSize(width, height);
  }
});

ipcMain.on('write-clipboard', (event, text) => {
  if (text) {
    require('electron').clipboard.writeText(text);
  }
});

ipcMain.on('focus-window', () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

ipcMain.on('update-session-encoding', (event, { sessionId, encoding }) => {
  const session = sessions.get(sessionId);
  if (session) {
    session.service.setEncoding(encoding);
  }
});

ipcMain.on('disconnect-session', (event, sessionId) => {
  const session = sessions.get(sessionId);
  if (session) {
    session.service.disconnect();
    logManager.stopLogging(sessionId);
    sessions.delete(sessionId);
    win?.webContents.send('session-status', { sessionId, status: 'disconnected' });
  }
});

ipcMain.on('app-quit', () => {
  sessions.forEach(s => {
    s.service.disconnect();
    logManager.stopLogging(s.id);
  });
  sessions.clear();
  app.quit();
});

// Serial port auto-detection
ipcMain.handle('list-serial-ports', async () => {
  try {
    const ports = await SerialPort.list();
    return ports.map(p => ({
      path: p.path,
      manufacturer: p.manufacturer || '',
      pnpId: p.pnpId || '',
    }));
  } catch (err: any) {
    console.error('Failed to list serial ports:', err);
    return [];
  }
});

ipcMain.handle('select-image', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(win!, {
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['jpg', 'png', 'gif', 'svg', 'webp'] }],
  });
  if (canceled || filePaths.length === 0) {
    return null;
  }
  const selectedPath = filePaths[0];
  // Add to whitelist
  allowedMediaPaths.add(join(selectedPath));
  return selectedPath;
});

ipcMain.handle('select-folder', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(win!, {
    properties: ['openDirectory'],
  });
  if (canceled || filePaths.length === 0) {
    return null;
  }
  return filePaths[0];
});

// ── Context Menu ──
ipcMain.on('show-context-menu', (event, selection: string, commands?: { id: string; label: string }[]) => {
  const geminiSubmenu: Electron.MenuItemConstructorOptions[] = [];

  if (commands && commands.length > 0) {
    commands.forEach(cmd => {
      geminiSubmenu.push({
        label: cmd.label,
        click: () => { event.sender.send('ask-gemini', selection, cmd.id); }
      });
    });
  } else {
    // Default commands if none provided (for backward compatibility/fallback)
    geminiSubmenu.push(
      {
        label: 'What is this?',
        click: () => { event.sender.send('ask-gemini', selection, 'what-is-this'); }
      },
      {
        label: 'What does it mean?',
        click: () => { event.sender.send('ask-gemini', selection, 'what-does-it-mean'); }
      },
      {
        label: 'Research root cause',
        click: () => { event.sender.send('ask-gemini', selection, 'root-cause'); }
      }
    );
  }

  const template = [
    {
      label: 'Ask Gemini',
      enabled: !!selection,
      submenu: geminiSubmenu
    },
    { type: 'separator' },
    { role: 'copy' },
    { role: 'paste' },
    { type: 'separator' },
    { role: 'selectAll' }
  ] as Electron.MenuItemConstructorOptions[];

  const menu = Menu.buildFromTemplate(template);
  menu.popup({ window: BrowserWindow.fromWebContents(event.sender) || undefined });
});

// ── Gemini AI IPC Handlers ──

ipcMain.handle('gemini-auth-start', async (_, { clientId, clientSecret }) => {
  if (!geminiService) return false;
  return await geminiService.startAuth(clientId, clientSecret);
});

ipcMain.handle('gemini-auth-status', () => {
  return geminiService?.isAuthenticated() || false;
});

ipcMain.on('gemini-auth-logout', () => {
  geminiService?.logout();
});

ipcMain.on('gemini-chat-send', async (_, { sessionId, message, model, systemInstruction }) => {
  if (!geminiService) return;
  await geminiService.sendMessage(sessionId, message, model, systemInstruction);
});

ipcMain.on('gemini-chat-cancel', (_, sessionId: string) => {
  geminiService?.cancelMessage(sessionId);
});

ipcMain.handle('gemini-list-models', async () => {
  return await geminiService?.listModels() || [];
});

ipcMain.on('gemini-chat-clear', (_, sessionId: string) => {
  geminiService?.clearHistory(sessionId);
});

ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});

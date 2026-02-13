import { app, BrowserWindow, shell, ipcMain, dialog } from 'electron';
import { release } from 'node:os';
import { join } from 'node:path';
import { SshService } from './services/ssh';
import { TelnetService } from './services/telnet';
import { SerialService } from './services/serial';
import { SerialPort } from 'serialport';
import type { ISessionService } from './services/ISessionService';

// Disable GPU Acceleration for Windows 7
if (release().startsWith('6.1')) app.disableHardwareAcceleration()

// Set application name for Windows 10+ notifications
if (process.platform === 'win32') app.setAppUserModelId(app.getName())

if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}

let win: BrowserWindow | null = null

const preload = join(__dirname, '../preload/index.js')
const url = process.env.VITE_DEV_SERVER_URL
const indexHtml = join(process.env.DIST || 'dist', 'index.html')

async function createWindow() {
  win = new BrowserWindow({
    title: 'HoTTY',
    // If dev env, assume public/favicon.ico. If prod, assume dist/favicon.ico
    icon: join(process.env.PUBLIC || 'public', 'favicon.ico'),
    width: 1200,
    height: 800,
    webPreferences: {
      preload,
      nodeIntegration: false,
      contextIsolation: true,
    },
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
      return callback(decodeURIComponent(url));
    } catch (error) {
      console.error('Failed to register protocol', error);
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
ipcMain.handle('open-win', (_, arg) => {
  const childWindow = new BrowserWindow({
    webPreferences: {
      preload,
      nodeIntegration: false,
      contextIsolation: true,
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
    sessions.delete(sessionId);
    win?.webContents.send('session-status', { sessionId, status: 'disconnected' });
  }
});

ipcMain.on('app-quit', () => {
  sessions.forEach(s => s.service.disconnect());
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
  return filePaths[0];
});

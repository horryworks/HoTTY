import { app, BrowserWindow, shell, ipcMain, dialog, Menu, MenuItem } from 'electron';
import { release } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { SshService } from './services/ssh';
import { TelnetService } from './services/telnet';
import { SerialService } from './services/serial';
import { WslService } from './services/wsl';
import { LocalService } from './services/local';
import { SerialPort } from 'serialport';
import type { ISessionService } from './services/ISessionService';
import { GeminiService } from './services/gemini';
import { LogManager } from './services/LogManager';
import { encryptString, decryptString } from './services/dpapi';
import { exec } from 'child_process';
import { promisify } from 'util';
const execAsync = promisify(exec);
import * as fs from 'fs';
import * as crypto from 'crypto';
if (release().startsWith('6.1')) app.disableHardwareAcceleration()

// Set application name for Windows 10+ notifications
if (process.platform === 'win32') app.setAppUserModelId(app.getName())

if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}

const windows = new Set<BrowserWindow>();
let geminiService: GeminiService | null = null;
const logManager = new LogManager();

// Security: track directories the user has explicitly allowed for log access
const allowedLogDirs = new Set<string>();
// Security: path selected server-side by select-import-file, used by decrypt-import-file
let pendingImportFilePath: string | null = null;

const preload = join(__dirname, '../preload/index.js')
const url = process.env.VITE_DEV_SERVER_URL
const indexHtml = join(process.env.DIST || 'dist', 'index.html')

const mediaTokensPath = join(app.getPath('userData'), 'media_tokens.json');
let mediaTokens: Record<string, string> = {};
try {
  if (fs.existsSync(mediaTokensPath)) {
    mediaTokens = JSON.parse(fs.readFileSync(mediaTokensPath, 'utf8'));
  }
} catch (e) {
  console.error('Failed to load media tokens:', e);
}

function saveMediaTokens() {
  try {
    fs.writeFileSync(mediaTokensPath, JSON.stringify(mediaTokens, null, 2), 'utf8');
  } catch (e) {
    console.error('Failed to save media tokens:', e);
  }
}

async function createWindow() {
  const newWin = new BrowserWindow({
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

  windows.add(newWin);

  // Hide menu bar
  newWin.setMenuBarVisibility(false)

  if (process.env.VITE_DEV_SERVER_URL) {
    newWin.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    newWin.loadFile(indexHtml)
  }

  // Make all links open with the browser, not with the application
  newWin.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:')) shell.openExternal(url)
    return { action: 'deny' }
  })

  newWin.on('closed', () => {
    windows.delete(newWin);
  });

  return newWin;
}

app.whenReady().then(async () => {
  const firstWin = await createWindow();
  geminiService = new GeminiService();

  // Register 'media' protocol to serve local files
  const { protocol, net } = require('electron');
  const { pathToFileURL } = require('url');

  protocol.handle('media', (request: Request) => {
    // The URL comes as media:///token or media://token
    const token = request.url.replace(/^media:\/\/\/?/, '').split(/[?#]/)[0];

    const actualPath = mediaTokens[token];
    if (!actualPath) {
      console.warn('Blocked unauthorized media protocol access or invalid token:', token);
      return new Response('Access Denied', { status: 403 });
    }

    try {
      return net.fetch(pathToFileURL(actualPath).toString());
    } catch (error) {
      console.error('Failed to handle media protocol', error);
      return new Response('Internal Error', { status: 500 });
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('second-instance', () => {
  createWindow();
})

app.on('activate', () => {
  if (windows.size === 0) {
    createWindow()
  }
})

// IPC Handlers
const debugLogPath = join(app.getPath('userData'), 'debug_gemini.log');

const logToDebugFile = (message: string) => {
  if (app.isPackaged) return; // Disable debug file logging in production
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}\n`;
  console.log(logMessage);
  fs.appendFile(debugLogPath, logMessage, (err) => {
    if (err) console.error('Failed to write request log', err);
  });
};

ipcMain.on('log-debug', (_, message) => {
  logToDebugFile(message);
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

ipcMain.on('open-external', (_, url) => {
  if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
    shell.openExternal(url);
  } else {
    console.warn('[Security] open-external blocked non-https URL:', url);
  }
});

// Session Management
interface Session {
  id: string;
  type: 'ssh' | 'telnet' | 'serial' | 'wsl' | 'local';
  service: ISessionService;
  host?: string;
  protocol?: string;
}

const sessions = new Map<string, Session>();

const VALID_PROTOCOLS = new Set(['ssh', 'telnet', 'serial', 'wsl', 'cmd', 'powershell', 'local']);

ipcMain.on('connect-session', async (event, { sessionId, config }) => {
  const eventWin = BrowserWindow.fromWebContents(event.sender);
  if (!eventWin) return;

  // Validate protocol
  if (typeof config.protocol !== 'string' || !VALID_PROTOCOLS.has(config.protocol)) {
    config.protocol = 'ssh';
  }

  // Validate port range
  if (config.port !== undefined) {
    const port = Number(config.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      eventWin.webContents.send('session-error', { sessionId, error: 'Invalid port number' });
      return;
    }
    config.port = port;
  }

  // Cleanup existing if reusing ID (shouldn't happen with UUIDs but good safety)
  if (sessions.has(sessionId)) {
    const oldSession = sessions.get(sessionId)!;
    oldSession.service.disconnect();
    sessions.delete(sessionId);
  }

  const protocol = config.protocol;
  let service: ISessionService;

  if (protocol === 'ssh') {
    service = new SshService(eventWin, sessionId);
  } else if (protocol === 'telnet') {
    service = new TelnetService(eventWin, sessionId);
  } else if (protocol === 'wsl') {
    service = new WslService(eventWin, sessionId);
  } else if (protocol === 'cmd' || protocol === 'powershell') {
    service = new LocalService(eventWin, sessionId);
  } else {
    service = new SerialService(eventWin, sessionId);
  }

  sessions.set(sessionId, {
    id: sessionId,
    type: protocol,
    service: service,
    host: config.host,
    protocol: config.protocol
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
  const eventWin = BrowserWindow.fromWebContents(event.sender);
  if (eventWin) {
    eventWin.setSize(width, height);
  }
});

ipcMain.on('write-clipboard', (event, text) => {
  if (text) {
    require('electron').clipboard.writeText(text);
  }
});

ipcMain.on('focus-window', (event) => {
  const eventWin = BrowserWindow.fromWebContents(event.sender);
  if (eventWin) {
    if (eventWin.isMinimized()) eventWin.restore();
    eventWin.focus();
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
    const eventWin = BrowserWindow.fromWebContents(event.sender);
    eventWin?.webContents.send('session-status', { sessionId, status: 'disconnected' });
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

// Update logging for all active sessions
ipcMain.on('update-logging', (event, { loggingEnabled, loggingPath }) => {
  if (loggingEnabled && loggingPath) {
    allowedLogDirs.add(resolve(loggingPath));
  }
  sessions.forEach((session, sessionId) => {
    if (loggingEnabled && loggingPath) {
      // Start logging if not already logging
      logManager.startLogging(sessionId, {
        loggingEnabled,
        loggingPath,
        host: session.host,
        protocol: session.protocol
      });
    } else {
      // Stop logging
      logManager.stopLogging(sessionId);
    }
  });
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

ipcMain.handle('select-image', async (event) => {
  const eventWin = BrowserWindow.fromWebContents(event.sender);
  const { canceled, filePaths } = await dialog.showOpenDialog(eventWin!, {
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['jpg', 'png', 'gif', 'svg', 'webp'] }],
  });
  if (canceled || filePaths.length === 0) {
    return null;
  }
  const selectedPath = join(filePaths[0]);

  // Check if we already have a token for this path
  let token = Object.keys(mediaTokens).find(k => mediaTokens[k] === selectedPath);
  if (!token) {
    token = crypto.randomUUID();
    mediaTokens[token] = selectedPath;
    saveMediaTokens();
  }

  return token; // Return the token, UI will use media://token
});

ipcMain.handle('select-folder', async (event) => {
  const eventWin = BrowserWindow.fromWebContents(event.sender);
  const { canceled, filePaths } = await dialog.showOpenDialog(eventWin!, {
    properties: ['openDirectory'],
  });
  if (canceled || filePaths.length === 0) {
    return null;
  }
  return filePaths[0];
});

ipcMain.handle('list-wsl-distributions', async () => {
  try {
    const { stdout } = await execAsync('wsl.exe --list --quiet');
    return stdout.split('\n')
      .map(s => s.replace(/[\r\0]/g, '').trim()) // Remove \r and \0, then trim whitespace
      .filter(s => s.length > 0);
  } catch (err) {
    console.error('Failed to list WSL distributions:', err);
    return [];
  }
});



// ── Context Menu ──
ipcMain.on('show-context-menu', (event, selection: string, commands?: { id: string; label: string }[], includePaste: boolean = true) => {
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

  const isWatchBuffer = selection === '__WATCH_BUFFER__';

  // Append free format option only if not watch buffer
  if (!isWatchBuffer) {
    geminiSubmenu.push(
      { type: 'separator' },
      {
        label: 'Free format question...',
        click: () => { event.sender.send('ask-gemini', selection, 'free-format'); }
      }
    );
  }

  const template: Electron.MenuItemConstructorOptions[] = [];

  if (isWatchBuffer) {
    // Flattened menu for sparkles button
    geminiSubmenu.forEach(item => template.push(item));
  } else {
    // Nested menu for context
    if (includePaste) {
      template.push(
        {
          label: 'Paste',
          click: () => { event.sender.send('terminal-context-paste'); }
        },
        { type: 'separator' }
      );
    }
    template.push({
      label: 'Ask Gemini',
      enabled: !!selection,
      submenu: geminiSubmenu
    });
  }

  const menu = Menu.buildFromTemplate(template);
  menu.popup({ window: BrowserWindow.fromWebContents(event.sender) || undefined });
});

// ── Gemini AI IPC Handlers ──

ipcMain.handle('gemini-auth-start', async (event, { clientId, clientSecret }) => {
  if (!geminiService) return false;
  const eventWin = BrowserWindow.fromWebContents(event.sender);
  if (!eventWin) return false;
  return await geminiService.startAuth(eventWin, clientId, clientSecret);
});

ipcMain.handle('gemini-auth-auto', async (_, { clientId, clientSecret }) => {
  if (!geminiService) return false;
  return await geminiService.autoAuth(clientId, clientSecret);
});

ipcMain.handle('gemini-auth-status', () => {
  return geminiService?.isAuthenticated() || false;
});

ipcMain.on('gemini-auth-logout', () => {
  geminiService?.logout();
});

ipcMain.on('gemini-chat-send', async (event, { sessionId, message, model, systemInstruction }) => {
  if (!geminiService) return;
  const eventWin = BrowserWindow.fromWebContents(event.sender);
  if (!eventWin) return;
  await geminiService.sendMessage(eventWin, sessionId, message, model, systemInstruction);
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

const getSshAlgorithmsPath = () => {
  const userDataPath = join(app.getPath('userData'), 'ssh_algorithms.json');

  // If user data doesn't have the file, copy it from resources
  if (!fs.existsSync(userDataPath)) {
    const defaultPath = app.isPackaged
      ? join(process.resourcesPath, 'resources', 'ssh_algorithms.json')
      : join(app.getAppPath(), 'resources', 'ssh_algorithms.json');

    try {
      if (fs.existsSync(defaultPath)) {
        fs.copyFileSync(defaultPath, userDataPath);
        console.log('Initialized ssh_algorithms.json in userData');
      } else {
        console.error('Default ssh_algorithms.json not found at:', defaultPath);
      }
    } catch (err) {
      console.error('Failed to initialize ssh_algorithms.json:', err);
    }
  }

  return userDataPath;
};

ipcMain.handle('get-ssh-algorithms', async () => {
  try {
    const algorithmsPath = getSshAlgorithmsPath();
    if (fs.existsSync(algorithmsPath)) {
      const content = fs.readFileSync(algorithmsPath, 'utf8');
      return JSON.parse(content);
    }
  } catch (err) {
    console.error('Failed to get SSH algorithms:', err);
  }
  return null;
});

ipcMain.handle('save-ssh-algorithms', async (_, algorithms) => {
  try {
    const algorithmsPath = getSshAlgorithmsPath();
    fs.writeFileSync(algorithmsPath, JSON.stringify(algorithms, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('Failed to save SSH algorithms:', err);
    return false;
  }
});

ipcMain.handle('get-themes', async () => {
  const resourcesDir = app.isPackaged
    ? join(process.resourcesPath, 'resources')
    : join(app.getAppPath(), 'resources');

  const themes: Record<string, any> = {};
  try {
    const files = fs.readdirSync(resourcesDir);
    for (const file of files) {
      if (!file.endsWith('.json') || file === 'ssh_algorithms.json') continue;
      const themeName = file.replace('.json', '');
      try {
        const content = fs.readFileSync(join(resourcesDir, file), 'utf8');
        themes[themeName] = JSON.parse(content);
      } catch (err) {
        console.error(`Failed to load theme ${file}:`, err);
      }
    }
  } catch (err) {
    console.error('Failed to read resources directory:', err);
  }
  return Object.keys(themes).length > 0 ? themes : null;
});

ipcMain.handle('save-custom-theme', async (_, themeKey: string, themeData: any) => {
  if (typeof themeKey !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(themeKey)) {
    return { success: false, error: 'Invalid theme name. Use only letters, numbers, hyphens, and underscores.' };
  }
  const PROTECTED = ['dark', 'medium', 'light'];
  if (PROTECTED.includes(themeKey.toLowerCase())) {
    return { success: false, error: 'Cannot overwrite built-in theme' };
  }

  const resourcesDir = app.isPackaged
    ? join(process.resourcesPath, 'resources')
    : join(app.getAppPath(), 'resources');

  const filePath = join(resourcesDir, `${themeKey}.json`);
  try {
    fs.writeFileSync(filePath, JSON.stringify(themeData, null, 4), 'utf8');
    return { success: true };
  } catch (err) {
    console.error('Failed to save custom theme:', err);
    return { success: false, error: String(err) };
  }
});

ipcMain.handle('delete-custom-theme', async (_, themeKey: string) => {
  if (typeof themeKey !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(themeKey)) {
    return { success: false, error: 'Invalid theme name.' };
  }
  const PROTECTED = ['dark', 'medium', 'light'];
  if (PROTECTED.includes(themeKey.toLowerCase())) {
    return { success: false, error: 'Cannot delete built-in theme' };
  }

  const resourcesDir = app.isPackaged
    ? join(process.resourcesPath, 'resources')
    : join(app.getAppPath(), 'resources');

  const filePath = join(resourcesDir, `${themeKey}.json`);
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    return { success: true };
  } catch (err) {
    console.error('Failed to delete custom theme:', err);
    return { success: false, error: String(err) };
  }
});

// ── DPAPI Credential Protection ──

ipcMain.handle('dpapi-encrypt', async (_, plaintext: string) => {
  try {
    return await encryptString(plaintext);
  } catch (err) {
    console.error('[DPAPI] IPC encrypt error:', err);
    throw err;
  }
});

ipcMain.handle('dpapi-decrypt', async (_, ciphertext: string) => {
  try {
    return await decryptString(ciphertext);
  } catch (err) {
    console.error('[DPAPI] IPC decrypt error:', err);
    throw err;
  }
});

ipcMain.handle('dpapi-encrypt-batch', async (_, plaintexts: (string | undefined)[]) => {
  try {
    return await Promise.all(plaintexts.map(text => text ? encryptString(text) : Promise.resolve(text)));
  } catch (err) {
    console.error('[DPAPI] IPC batch encrypt error:', err);
    throw err;
  }
});

ipcMain.handle('dpapi-decrypt-batch', async (_, ciphertexts: (string | undefined)[]) => {
  try {
    return await Promise.all(ciphertexts.map(text => text ? decryptString(text) : Promise.resolve(text)));
  } catch (err) {
    console.error('[DPAPI] IPC batch decrypt error:', err);
    throw err;
  }
});

// ── Host Tree Export/Import with Password Encryption ──
const MAGIC_NUMBER = 'HOTTY';

ipcMain.handle('export-htree', async (event, { data, password }) => {
  logToDebugFile('[Main] export-htree called');
  const eventWin = BrowserWindow.fromWebContents(event.sender);
  logToDebugFile(`[Main] eventWin found: ${!!eventWin}`);

  const { canceled, filePath } = await dialog.showSaveDialog(eventWin!, {
    title: 'Export Host Tree',
    defaultPath: 'hosts.htree',
    filters: [{ name: 'HoTTY Tree', extensions: ['htree'] }],
  });

  logToDebugFile(`[Main] Save dialog result: ${JSON.stringify({ canceled, filePath })}`);
  if (canceled || !filePath) return false;

  try {
    logToDebugFile('[Main] Deriving key...');
    const salt = crypto.randomBytes(16);
    const key = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256');

    logToDebugFile('[Main] Encrypting data...');
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();

    logToDebugFile('[Main] Constructing payload...');
    const payload = Buffer.concat([
      Buffer.from(MAGIC_NUMBER),
      salt,
      iv,
      tag,
      encrypted
    ]);

    fs.writeFileSync(filePath, payload);
    logToDebugFile('[Main] Export successful');
    return true;
  } catch (err: any) {
    logToDebugFile(`[Main] Export failed: ${err.message}`);
    throw err;
  }
});

ipcMain.handle('select-import-file', async (event) => {
  logToDebugFile('[Main] select-import-file called');
  const eventWin = BrowserWindow.fromWebContents(event.sender);
  const { canceled, filePaths } = await dialog.showOpenDialog(eventWin!, {
    title: 'Select HoTTY Tree File',
    filters: [{ name: 'HoTTY Tree', extensions: ['htree'] }],
    properties: ['openFile'],
  });

  logToDebugFile(`[Main] Open dialog result: canceled=${canceled}`);
  if (canceled || filePaths.length === 0) return null;
  // Store server-side; decrypt-import-file will use this, not a renderer-supplied path
  pendingImportFilePath = filePaths[0];
  return filePaths[0];
});

// ── Log Viewer ──

ipcMain.handle('list-log-files', async (_, folderPath: string) => {
  if (!folderPath) return { error: 'No log folder configured' };
  const resolvedFolder = resolve(folderPath);
  if (!fs.existsSync(resolvedFolder)) return { error: 'Log folder does not exist' };
  // Trust explicitly listed folder for subsequent read-log-file calls
  allowedLogDirs.add(resolvedFolder);
  try {
    const entries = fs.readdirSync(resolvedFolder);
    const files = entries
      .filter(f => /\.(txt|log)$/i.test(f) && !/\.tslog$/i.test(f))
      .map(f => {
        const fullPath = join(resolvedFolder, f);
        const stat = fs.statSync(fullPath);
        return { name: f, path: fullPath, mtime: stat.mtimeMs, size: stat.size };
      })
      .sort((a, b) => b.mtime - a.mtime);
    return { files };
  } catch (err) {
    return { error: String(err) };
  }
});

ipcMain.handle('read-log-file', async (_, filePath: string) => {
  if (!filePath || !/\.(txt|log|tslog)$/i.test(filePath)) return { error: 'Invalid file type' };

  // Path traversal protection: file must be within an allowed log directory
  const resolvedPath = resolve(filePath);
  const resolvedLower = resolvedPath.toLowerCase();
  const inAllowedDir = [...allowedLogDirs].some(dir => {
    const prefix = (dir.endsWith(sep) ? dir : dir + sep).toLowerCase();
    return resolvedLower.startsWith(prefix);
  });
  if (!inAllowedDir) {
    console.warn('[Security] read-log-file blocked:', resolvedPath);
    return { error: 'Access denied: file is outside the configured log directory' };
  }

  try {
    const stat = await fs.promises.stat(resolvedPath);
    if (!stat.isFile()) return { error: 'File not found' };
    const MAX_SIZE = 50 * 1024 * 1024; // 50 MB
    if (stat.size > MAX_SIZE) return { error: `File too large (${(stat.size / 1024 / 1024).toFixed(1)} MB). Limit is 50 MB.` };
    const content = await fs.promises.readFile(resolvedPath, 'utf8');
    return { content };
  } catch (err: any) {
    if (err.code === 'ENOENT') return { error: 'File not found' };
    return { error: String(err) };
  }
});

ipcMain.handle('decrypt-import-file', async (event, { password }) => {
  // Use only the server-side path stored by select-import-file (never trust renderer-supplied path)
  if (!pendingImportFilePath) {
    throw new Error('No import file selected. Please select a file first.');
  }
  const filePath = pendingImportFilePath;
  pendingImportFilePath = null; // Single-use: clear after consuming
  logToDebugFile('[Main] decrypt-import-file called');
  try {
    logToDebugFile('[Main] Reading file...');
    const payload = fs.readFileSync(filePath);

    const magic = payload.subarray(0, 5).toString();
    logToDebugFile(`[Main] Magic number check: ${magic}`);
    if (magic !== MAGIC_NUMBER) {
      throw new Error('Not a valid HoTTY tree file');
    }

    const salt = payload.subarray(5, 5 + 16);
    const iv = payload.subarray(21, 21 + 12);
    const tag = payload.subarray(33, 33 + 16);
    const encrypted = payload.subarray(49);

    logToDebugFile('[Main] Deriving key for import...');
    const key = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256');

    logToDebugFile('[Main] Decrypting data...');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);

    logToDebugFile('[Main] Decryption successful');
    return JSON.parse(decrypted.toString('utf8'));
  } catch (err: any) {
    logToDebugFile(`[Main] Decryption failed: ${err.message}`);
    throw new Error('Invalid password or corrupted file.');
  }
});



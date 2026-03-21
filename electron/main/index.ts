import { app, BrowserWindow, shell, ipcMain, dialog, Menu, clipboard, protocol, net } from 'electron';
import { release } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { SshService } from './services/ssh';
import { TelnetService } from './services/telnet';
import { SerialService } from './services/serial';
import { WslService } from './services/wsl';
import { LocalService } from './services/local';
import { SerialPort } from 'serialport';
import type { ISessionService } from './services/ISessionService';
import { AIProviderRegistry } from './services/ai/AIProviderRegistry';
import { AIService } from './services/ai/AIService';
import { GeminiProvider } from './services/ai/providers/gemini/GeminiProvider';
import { VertexAIProvider } from './services/ai/providers/vertexai/VertexAIProvider';
import { OpenAIProvider } from './services/ai/providers/openai/OpenAIProvider';
import { AnthropicProvider } from './services/ai/providers/anthropic/AnthropicProvider';
import { LogManager } from './services/LogManager';
import { PingMonitorService, isValidPingTarget } from './services/PingMonitorService';
import { logger } from './services/Logger';
import { encryptString, decryptString, encodePowerShellScript } from './services/dpapi';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { pathToFileURL } from 'url';
const execFileAsync = promisify(execFile);
import * as fs from 'fs';
import * as crypto from 'crypto';
import { isNewerVersion } from '../../src/utils/versionUtils';
if (release().startsWith('6.1')) app.disableHardwareAcceleration()

// Set application name for Windows 10+ notifications
if (process.platform === 'win32') app.setAppUserModelId(app.getName())

if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}

const windows = new Set<BrowserWindow>();
let aiService: AIService | null = null;
const logManager = new LogManager();
const pingMonitors = new Map<string, PingMonitorService>();

// Security: track directories the user has explicitly allowed for log access
const allowedLogDirs = new Set<string>();
// Security: path selected server-side by select-import-file, used by decrypt-import-file
let pendingImportFilePath: string | null = null;

const preload = join(__dirname, '../preload/index.js')
const indexHtml = join(process.env.DIST || 'dist', 'index.html')

const mediaTokensPath = join(app.getPath('userData'), 'media_tokens.json');
let mediaTokens: Record<string, string> = {};
const MEDIA_TOKENS_MAX_SIZE = 100 * 1024; // 100 KB
try {
  if (fs.existsSync(mediaTokensPath)) {
    const stat = fs.statSync(mediaTokensPath);
    if (stat.size <= MEDIA_TOKENS_MAX_SIZE) {
      const raw = JSON.parse(fs.readFileSync(mediaTokensPath, 'utf8'));
      // Schema validation: only accept string → string mappings
      if (raw && typeof raw === 'object' && !Array.isArray(raw) &&
          Object.values(raw).every(v => typeof v === 'string')) {
        mediaTokens = raw as Record<string, string>;
      } else {
        logger.warn('app', 'media_tokens.json has unexpected schema, ignoring');
      }
    } else {
      logger.warn('app', 'media_tokens.json exceeds size limit, ignoring');
    }
  }
} catch (e) {
  logger.error('app', 'Failed to load media tokens', { error: String(e) });
}

function saveMediaTokens() {
  try {
    fs.writeFileSync(mediaTokensPath, JSON.stringify(mediaTokens, null, 2), 'utf8');
  } catch (e) {
    logger.error('app', 'Failed to save media tokens', { error: String(e) });
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
      webSecurity: true,
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

async function checkForUpdates(win: BrowserWindow): Promise<void> {
  try {
    const res = await net.fetch('https://api.github.com/repos/horryworks/HoTTY/releases/latest', {
      headers: { 'User-Agent': `HoTTY/${app.getVersion()}` },
    });
    if (!res.ok) return;
    const data = await res.json() as { tag_name?: string; prerelease?: boolean; html_url?: string };
    if (!data.tag_name || data.prerelease) return;
    const latestVersion = data.tag_name.replace(/^v/, '');
    const currentVersion = app.getVersion();
    if (isNewerVersion(latestVersion, currentVersion)) {
      win.webContents.send('update-available', {
        version: latestVersion,
        releaseUrl: data.html_url ?? '',
      });
    }
  } catch (e) {
    logger.warn('app', 'Update check failed', { error: String(e) });
  }
}

app.whenReady().then(async () => {
  logger.initialize(app.getPath('userData'));
  logger.info('app', 'App started', {
    version: app.getVersion(),
    electron: process.versions.electron,
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch,
  });

  const win = await createWindow();
  const registry = new AIProviderRegistry();
  registry.register(new GeminiProvider());
  registry.register(new VertexAIProvider());
  registry.register(new OpenAIProvider());
  registry.register(new AnthropicProvider());
  aiService = new AIService(registry, 'gemini');
  win.webContents.once('did-finish-load', () => { checkForUpdates(win); });

  // Register 'media' protocol to serve local files
  protocol.handle('media', (request: Request) => {
    // The URL comes as media:///token or media://token
    const token = request.url.replace(/^media:\/\/\/?/, '').split(/[?#]/)[0];

    const actualPath = mediaTokens[token];
    if (!actualPath || typeof actualPath !== 'string') {
      logger.warn('app', 'Blocked unauthorized media token');
      return new Response('Access Denied', { status: 403 });
    }

    try {
      // Resolve symlinks to get the real path and confirm it is a regular file
      const realPath = fs.realpathSync(actualPath);
      const stat = fs.statSync(realPath);
      if (!stat.isFile()) {
        logger.warn('app', 'Media token path is not a regular file');
        return new Response('Access Denied', { status: 403 });
      }
      return net.fetch(pathToFileURL(realPath).toString());
    } catch (error) {
      logger.error('app', 'Failed to handle media protocol', { error: String(error) });
      return new Response('Internal Error', { status: 500 });
    }
  });
});

app.on('before-quit', () => {
  sessions.forEach(s => {
    s.service.disconnect();
    logManager.stopLogging(s.id);
  });
  sessions.clear();
  pingMonitors.forEach(pm => pm.stop());
  pingMonitors.clear();
  logger.close();
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

ipcMain.on('log-debug', (_, message) => {
  if (typeof message === 'string' && message.length <= 10000) {
    logger.debug('renderer', message);
  }
});

// IPC Handlers
ipcMain.handle('open-win', (_, arg) => {
  // Input validation for 'arg' (hash)
  if (typeof arg !== 'string' || !/^[a-zA-Z0-9_-]*$/.test(arg)) {
    logger.warn('app', 'Invalid window hash argument');
    return;
  }

  const childWindow = new BrowserWindow({
    webPreferences: {
      preload,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
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
    logger.warn('app', '[Security] open-external blocked non-https URL');
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
    logger.warn('session', 'Invalid protocol, fallback to ssh', { given: config.protocol });
    config.protocol = 'ssh';
  }

  // Validate port range
  if (config.port !== undefined) {
    const port = Number(config.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      logger.warn('session', 'Invalid port number', { sessionId, port: config.port });
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

  // Validate WSL distro against the list of installed distributions
  if (protocol === 'wsl' && config.distro) {
    try {
      const { stdout } = await execFileAsync('wsl.exe', ['--list', '--quiet']);
      const validDistros = stdout.split('\n')
        .map((s: string) => s.replace(/[\r\0]/g, '').trim())
        .filter((s: string) => s.length > 0);
      if (!validDistros.includes(config.distro)) {
        logger.warn('session', 'Unknown WSL distribution', { distro: config.distro });
        eventWin.webContents.send('session-error', { sessionId, error: 'Unknown WSL distribution' });
        return;
      }
    } catch {
      // wsl.exe not available — let WslService handle the error at spawn time
    }
  }

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
    const validWidth = Number.isInteger(width) && width >= 100 && width <= 7680 ? width : 1200;
    const validHeight = Number.isInteger(height) && height >= 100 && height <= 4320 ? height : 800;
    eventWin.setSize(validWidth, validHeight);
  }
});

ipcMain.on('write-clipboard', (event, text) => {
  if (text) {
    clipboard.writeText(text);
  }
});

ipcMain.on('focus-window', (event) => {
  const eventWin = BrowserWindow.fromWebContents(event.sender);
  if (eventWin) {
    if (eventWin.isMinimized()) eventWin.restore();
    eventWin.focus();
  }
});

const ALLOWED_ENCODINGS = new Set(['utf8', 'shift_jis', 'euc-jp']);

ipcMain.on('update-session-encoding', (event, { sessionId, encoding }) => {
  if (!ALLOWED_ENCODINGS.has(encoding)) {
    logger.warn('session', 'Invalid encoding rejected', { sessionId, encoding });
    return;
  }
  const session = sessions.get(sessionId);
  if (session) {
    session.service.setEncoding(encoding);
  }
});

ipcMain.on('disconnect-session', (event, sessionId) => {
  const session = sessions.get(sessionId);
  if (session) {
    logger.info('session', 'Disconnect', { sessionId, protocol: session.protocol });
    session.service.disconnect();
    logManager.stopLogging(sessionId);
    sessions.delete(sessionId);
    const eventWin = BrowserWindow.fromWebContents(event.sender);
    eventWin?.webContents.send('session-status', { sessionId, status: 'disconnected' });
  }
});

ipcMain.on('app-quit', () => {
  logger.info('app', 'App quit requested');
  sessions.forEach(s => {
    s.service.disconnect();
    logManager.stopLogging(s.id);
  });
  sessions.clear();
  logger.close();
  app.quit();
});

ipcMain.handle('open-debug-log-folder', () => {
  shell.openPath(logger.getLogDir());
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
  } catch (err: unknown) {
    logger.error('app', 'Failed to list serial ports', { error: String(err) });
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
    const { stdout } = await execFileAsync('wsl.exe', ['--list', '--quiet']);
    return stdout.split('\n')
      .map(s => s.replace(/[\r\0]/g, '').trim()) // Remove \r and \0, then trim whitespace
      .filter(s => s.length > 0);
  } catch (err) {
    logger.error('app', 'Failed to list WSL distributions', { error: String(err) });
    return [];
  }
});

ipcMain.handle('list-system-fonts', async () => {
  try {
    const script = '[System.Reflection.Assembly]::LoadWithPartialName("System.Drawing") | Out-Null; ' +
      '(New-Object System.Drawing.Text.InstalledFontCollection).Families | ' +
      'Select-Object -ExpandProperty Name';
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encodePowerShellScript(script)]);
    return stdout.split('\n')
      .map(s => s.trim())
      .filter(s => s.length > 0);
  } catch (err) {
    logger.error('app', 'Failed to list system fonts', { error: String(err) });
    return [];
  }
});



// ── Ping Monitor ──

ipcMain.on('ping-monitor-start', (event, { sessionId, targets, intervalMs, loggingEnabled, loggingPath }) => {
  const eventWin = BrowserWindow.fromWebContents(event.sender);
  if (!eventWin) return;

  // Validate inputs
  if (typeof sessionId !== 'string' || !Array.isArray(targets) || typeof intervalMs !== 'number') {
    logger.warn('ping-monitor', 'Invalid start parameters');
    return;
  }

  // Filter and validate targets
  const validTargets = targets.filter((t: unknown) => typeof t === 'string' && isValidPingTarget(t as string)) as string[];
  if (validTargets.length === 0) {
    logger.warn('ping-monitor', 'No valid targets provided');
    return;
  }

  // Stop existing monitor if any
  const existing = pingMonitors.get(sessionId);
  if (existing) {
    existing.stop();
  }

  const monitor = new PingMonitorService(eventWin, sessionId);
  pingMonitors.set(sessionId, monitor);

  if (loggingEnabled && loggingPath) {
    allowedLogDirs.add(resolve(loggingPath));
  }

  monitor.start(validTargets, intervalMs, !!loggingEnabled, loggingPath || '');
});

ipcMain.on('ping-monitor-stop', (_, sessionId: string) => {
  const monitor = pingMonitors.get(sessionId);
  if (monitor) {
    monitor.stop();
    pingMonitors.delete(sessionId);
  }
});

ipcMain.on('ping-monitor-update-targets', (_, { sessionId, targets }) => {
  const monitor = pingMonitors.get(sessionId);
  if (monitor) {
    const validTargets = (targets as string[]).filter(t => typeof t === 'string' && isValidPingTarget(t));
    monitor.updateTargets(validTargets);
  }
});

ipcMain.on('ping-monitor-update-interval', (_, { sessionId, intervalMs }) => {
  const monitor = pingMonitors.get(sessionId);
  if (monitor && typeof intervalMs === 'number') {
    monitor.updateInterval(intervalMs);
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
      label: 'Ask AI',
      enabled: !!selection,
      submenu: geminiSubmenu
    });
  }

  const menu = Menu.buildFromTemplate(template);
  menu.popup({ window: BrowserWindow.fromWebContents(event.sender) || undefined });
});

// ── AI IPC Handlers ──

// Provider-agnostic ai-* channels (new)
ipcMain.handle('ai-auth-start', async (event, { credentials }) => {
  if (!aiService) return false;
  const eventWin = BrowserWindow.fromWebContents(event.sender);
  if (!eventWin) return false;
  return await aiService.authenticate(eventWin, credentials, (result) => {
    eventWin.webContents.send('ai-auth-result', result);
  });
});

ipcMain.handle('ai-auth-auto', async (_, { credentials }) => {
  if (!aiService) return false;
  return await aiService.autoAuth(credentials);
});

ipcMain.handle('ai-auth-status', () => {
  return aiService?.getAuthStatus().authenticated ?? false;
});

ipcMain.on('ai-auth-logout', () => {
  aiService?.logout();
});

ipcMain.on('ai-chat-send', async (event, { sessionId, message, model, systemInstruction }) => {
  if (!aiService) return;
  const eventWin = BrowserWindow.fromWebContents(event.sender);
  if (!eventWin) return;
  await aiService.sendMessage(eventWin, sessionId, message, model, systemInstruction);
});

ipcMain.on('ai-chat-cancel', (_, sessionId: string) => {
  aiService?.cancelMessage(sessionId);
});

ipcMain.handle('ai-list-models', async () => {
  return await aiService?.listModels() ?? [];
});

ipcMain.handle('ai-list-locations', async () => {
  return await aiService?.listLocations() ?? [];
});

ipcMain.on('ai-chat-clear', (_, sessionId: string) => {
  aiService?.clearHistory(sessionId);
});

ipcMain.handle('ai-list-providers', () => {
  return aiService?.listProviders() ?? [];
});

ipcMain.handle('ai-set-location', (_, location: unknown) => {
  if (typeof location !== 'string' || !/^(?:global|[a-z][a-z0-9-]+)$/.test(location)) {
    logger.warn('app', 'ai-set-location: invalid location');
    return;
  }
  aiService?.setLocation(location);
});

ipcMain.handle('ai-set-provider', (_, providerId: unknown) => {
  if (typeof providerId !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(providerId)) {
    logger.warn('app', 'ai-set-provider: invalid provider id');
    return;
  }
  aiService?.setActiveProvider(providerId);
});

ipcMain.handle('select-service-account-key-file', async (event) => {
  const eventWin = BrowserWindow.fromWebContents(event.sender);
  const { canceled, filePaths } = await dialog.showOpenDialog(eventWin!, {
    properties: ['openFile'],
    filters: [{ name: 'JSON Key File', extensions: ['json'] }],
  });
  if (canceled || filePaths.length === 0) return null;
  return filePaths[0];
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
        logger.info('app', 'Initialized ssh_algorithms.json in userData');
      } else {
        logger.error('app', 'Default ssh_algorithms.json not found', { path: defaultPath });
      }
    } catch (err) {
      logger.error('app', 'Failed to initialize ssh_algorithms.json', { error: String(err) });
    }
  }

  return userDataPath;
};

const SSH_ALGORITHMS_MAX_SIZE = 100 * 1024; // 100 KB

ipcMain.handle('get-ssh-algorithms', async () => {
  try {
    const algorithmsPath = getSshAlgorithmsPath();
    if (fs.existsSync(algorithmsPath)) {
      const stat = fs.statSync(algorithmsPath);
      if (stat.size > SSH_ALGORITHMS_MAX_SIZE) {
        logger.warn('app', 'ssh_algorithms.json exceeds size limit');
        return null;
      }
      const content = fs.readFileSync(algorithmsPath, 'utf8');
      return JSON.parse(content);
    }
  } catch (err) {
    logger.error('app', 'Failed to get SSH algorithms', { error: String(err) });
  }
  return null;
});

ipcMain.handle('save-ssh-algorithms', async (_, algorithms) => {
  try {
    const algorithmsPath = getSshAlgorithmsPath();
    fs.writeFileSync(algorithmsPath, JSON.stringify(algorithms, null, 2), 'utf8');
    return true;
  } catch (err) {
    logger.error('app', 'Failed to save SSH algorithms', { error: String(err) });
    return false;
  }
});

const THEME_FILE_MAX_SIZE = 100 * 1024; // 100 KB
// Windows reserved device names that must not be used as filenames
const WINDOWS_RESERVED_NAMES = /^(CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])$/i;

ipcMain.handle('get-themes', async () => {
  const resourcesDir = app.isPackaged
    ? join(process.resourcesPath, 'resources')
    : join(app.getAppPath(), 'resources');

  const themes: Record<string, Record<string, unknown>> = {};
  try {
    const files = fs.readdirSync(resourcesDir);
    for (const file of files) {
      if (!file.endsWith('.json') || file === 'ssh_algorithms.json') continue;
      const themeName = file.replace('.json', '');
      try {
        const filePath = join(resourcesDir, file);
        const stat = fs.statSync(filePath);
        if (stat.size > THEME_FILE_MAX_SIZE) {
          logger.warn('theme', `Theme file ${file} exceeds size limit, skipping`);
          continue;
        }
        const content = fs.readFileSync(filePath, 'utf8');
        themes[themeName] = JSON.parse(content);
      } catch (err) {
        logger.error('theme', `Failed to load theme ${file}`, { error: String(err) });
      }
    }
  } catch (err) {
    logger.error('theme', 'Failed to read resources directory', { error: String(err) });
  }
  return Object.keys(themes).length > 0 ? themes : null;
});

function isValidThemeData(data: unknown): boolean {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return false;
  const entries = Object.entries(data);
  if (entries.length === 0 || entries.length > 500) return false;
  return entries.every(([k, v]) =>
    typeof k === 'string' && k.length <= 100 &&
    typeof v === 'string' && (v as string).length <= 500
  );
}

ipcMain.handle('save-custom-theme', async (_, themeKey: string, themeData: unknown) => {
  if (typeof themeKey !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(themeKey)) {
    return { success: false, error: 'Invalid theme name. Use only letters, numbers, hyphens, and underscores.' };
  }
  if (WINDOWS_RESERVED_NAMES.test(themeKey)) {
    return { success: false, error: 'Invalid theme name.' };
  }
  const PROTECTED = ['dark', 'medium', 'light'];
  if (PROTECTED.includes(themeKey.toLowerCase())) {
    return { success: false, error: 'Cannot overwrite built-in theme' };
  }
  if (!isValidThemeData(themeData)) {
    return { success: false, error: 'Invalid theme data.' };
  }

  const resourcesDir = app.isPackaged
    ? join(process.resourcesPath, 'resources')
    : join(app.getAppPath(), 'resources');

  const filePath = join(resourcesDir, `${themeKey}.json`);
  try {
    fs.writeFileSync(filePath, JSON.stringify(themeData, null, 4), 'utf8');
    return { success: true };
  } catch (err) {
    logger.error('theme', 'Failed to save custom theme', { error: String(err) });
    return { success: false, error: 'Failed to save theme.' };
  }
});

ipcMain.handle('delete-custom-theme', async (_, themeKey: string) => {
  if (typeof themeKey !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(themeKey)) {
    return { success: false, error: 'Invalid theme name.' };
  }
  if (WINDOWS_RESERVED_NAMES.test(themeKey)) {
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
    logger.error('theme', 'Failed to delete custom theme', { error: String(err) });
    return { success: false, error: String(err) };
  }
});

// ── DPAPI Credential Protection ──

ipcMain.handle('dpapi-encrypt', async (_, plaintext: string) => {
  try {
    return await encryptString(plaintext);
  } catch (err) {
    logger.error('dpapi', 'Encrypt error', { error: String(err) });
    throw err;
  }
});

ipcMain.handle('dpapi-decrypt', async (_, ciphertext: string) => {
  try {
    return await decryptString(ciphertext);
  } catch (err) {
    logger.error('dpapi', 'Decrypt error', { error: String(err) });
    throw err;
  }
});

ipcMain.handle('dpapi-encrypt-batch', async (_, plaintexts: (string | undefined)[]) => {
  try {
    return await Promise.all(plaintexts.map(text => text ? encryptString(text) : Promise.resolve(text)));
  } catch (err) {
    logger.error('dpapi', 'Batch encrypt error', { error: String(err) });
    throw err;
  }
});

ipcMain.handle('dpapi-decrypt-batch', async (_, ciphertexts: (string | undefined)[]) => {
  try {
    return await Promise.all(ciphertexts.map(text => text ? decryptString(text) : Promise.resolve(text)));
  } catch (err) {
    logger.error('dpapi', 'Batch decrypt error', { error: String(err) });
    throw err;
  }
});

// ── Host Tree Export/Import with Password Encryption ──
const MAGIC_NUMBER = 'HOTTY';

ipcMain.handle('export-htree', async (event, { data, password }) => {
  logger.debug('app', 'export-htree called');
  const eventWin = BrowserWindow.fromWebContents(event.sender);
  logger.debug('app', 'export-htree window', { found: !!eventWin });

  const { canceled, filePath } = await dialog.showSaveDialog(eventWin!, {
    title: 'Export Host Tree',
    defaultPath: 'hosts.htree',
    filters: [{ name: 'HoTTY Tree', extensions: ['htree'] }],
  });

  logger.debug('app', 'export-htree save dialog', { canceled, filePath: filePath ?? null });
  if (canceled || !filePath) return false;

  try {
    logger.debug('app', 'export-htree deriving key');
    const salt = crypto.randomBytes(16);
    const key = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256');

    logger.debug('app', 'export-htree encrypting');
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();

    logger.debug('app', 'export-htree constructing payload');
    const payload = Buffer.concat([
      Buffer.from(MAGIC_NUMBER),
      salt,
      iv,
      tag,
      encrypted
    ]);

    fs.writeFileSync(filePath, payload);
    logger.info('app', 'export-htree success');
    return true;
  } catch (err: unknown) {
    logger.error('app', 'export-htree failed', { error: err instanceof Error ? err.message : String(err) });
    throw err;
  }
});

ipcMain.handle('select-import-file', async (event) => {
  logger.debug('app', 'select-import-file called');
  const eventWin = BrowserWindow.fromWebContents(event.sender);
  const { canceled, filePaths } = await dialog.showOpenDialog(eventWin!, {
    title: 'Select HoTTY Tree File',
    filters: [{ name: 'HoTTY Tree', extensions: ['htree'] }],
    properties: ['openFile'],
  });

  logger.debug('app', 'select-import-file dialog', { canceled });
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
  // Only allow reading from directories already registered via update-logging
  if (![...allowedLogDirs].some(dir => resolvedFolder === dir)) {
    return { error: 'Log folder is not in the allowed list' };
  }
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

  // Resolve symlinks to prevent symlink traversal attacks
  let realFilePath: string;
  try {
    realFilePath = fs.realpathSync(resolve(filePath));
  } catch {
    return { error: 'File not found' };
  }

  // Path traversal protection: file must be within an allowed log directory
  const resolvedLower = realFilePath.toLowerCase();
  const inAllowedDir = [...allowedLogDirs].some(dir => {
    try {
      const realDir = fs.realpathSync(dir);
      const prefix = (realDir.endsWith(sep) ? realDir : realDir + sep).toLowerCase();
      return resolvedLower.startsWith(prefix);
    } catch {
      return false;
    }
  });
  if (!inAllowedDir) {
    logger.warn('app', '[Security] read-log-file blocked path traversal attempt');
    return { error: 'Access denied: file is outside the configured log directory' };
  }

  try {
    const stat = await fs.promises.stat(realFilePath);
    if (!stat.isFile()) return { error: 'File not found' };
    const MAX_SIZE = 50 * 1024 * 1024; // 50 MB
    if (stat.size > MAX_SIZE) return { error: `File too large (${(stat.size / 1024 / 1024).toFixed(1)} MB). Limit is 50 MB.` };
    const content = await fs.promises.readFile(realFilePath, 'utf8');
    return { content };
  } catch (err: unknown) {
    if (err instanceof Error && (err as NodeJS.ErrnoException).code === 'ENOENT') return { error: 'File not found' };
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
  logger.debug('app', 'decrypt-import-file called');
  try {
    logger.debug('app', 'decrypt-import-file reading');
    const payload = fs.readFileSync(filePath);

    const magic = payload.subarray(0, 5).toString();
    logger.debug('app', 'decrypt-import-file magic check', { valid: magic === MAGIC_NUMBER });
    if (magic !== MAGIC_NUMBER) {
      throw new Error('Not a valid HoTTY tree file');
    }

    const salt = payload.subarray(5, 5 + 16);
    const iv = payload.subarray(21, 21 + 12);
    const tag = payload.subarray(33, 33 + 16);
    const encrypted = payload.subarray(49);

    logger.debug('app', 'decrypt-import-file deriving key');
    const key = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256');

    logger.debug('app', 'decrypt-import-file decrypting');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);

    logger.info('app', 'decrypt-import-file success');
    return JSON.parse(decrypted.toString('utf8'));
  } catch (err: unknown) {
    logger.error('app', 'decrypt-import-file failed', { error: err instanceof Error ? err.message : String(err) });
    throw new Error('Invalid password or corrupted file.');
  }
});



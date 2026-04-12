import { describe, it, expect, vi, beforeEach } from 'vitest';

const writeText = vi.fn();
const readText = vi.fn();
const mockInvoke = vi.fn();

vi.mock('@tauri-apps/plugin-clipboard-manager', () => ({
  writeText: (t: string) => writeText(t),
  readText: () => readText(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => mockInvoke(...args) }));
vi.mock('@tauri-apps/api/app', () => ({ getVersion: vi.fn().mockResolvedValue('0.0.0') }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));
vi.mock('@tauri-apps/api/webviewWindow', () => ({
  getCurrentWebviewWindow: () => ({ setTitle: vi.fn() }),
}));
vi.mock('@tauri-apps/plugin-shell', () => ({ open: vi.fn() }));

import { tauriService } from './tauriService';

describe('tauriService clipboard wrappers', () => {
  beforeEach(() => {
    writeText.mockReset();
    readText.mockReset();
  });

  it('writeClipboard forwards strings to the plugin', async () => {
    writeText.mockResolvedValue(undefined);
    await tauriService.writeClipboard('hello');
    expect(writeText).toHaveBeenCalledWith('hello');
  });

  it('writeClipboard skips empty strings', async () => {
    await tauriService.writeClipboard('');
    expect(writeText).not.toHaveBeenCalled();
  });

  it('writeClipboard skips payloads over 10 MB', async () => {
    const big = 'a'.repeat(10 * 1024 * 1024 + 1);
    await tauriService.writeClipboard(big);
    expect(writeText).not.toHaveBeenCalled();
  });

  it('readClipboard returns empty string when plugin returns null', async () => {
    readText.mockResolvedValue(null);
    await expect(tauriService.readClipboard()).resolves.toBe('');
  });

  it('readClipboard returns the plugin value', async () => {
    readText.mockResolvedValue('hi');
    await expect(tauriService.readClipboard()).resolves.toBe('hi');
  });
});

describe('tauriService system commands', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it('listSerialPorts invokes the correct command', async () => {
    mockInvoke.mockResolvedValue([{ path: 'COM3', displayName: 'COM3' }]);
    const result = await tauriService.listSerialPorts();
    expect(mockInvoke).toHaveBeenCalledWith('list_serial_ports');
    expect(result).toEqual([{ path: 'COM3', displayName: 'COM3' }]);
  });

  it('listWslDistributions invokes the correct command', async () => {
    mockInvoke.mockResolvedValue(['Ubuntu', 'Debian']);
    const result = await tauriService.listWslDistributions();
    expect(mockInvoke).toHaveBeenCalledWith('list_wsl_distributions');
    expect(result).toEqual(['Ubuntu', 'Debian']);
  });

  it('detectGitBash invokes the correct command', async () => {
    mockInvoke.mockResolvedValue('C:\\Program Files\\Git\\bin\\bash.exe');
    const result = await tauriService.detectGitBash();
    expect(mockInvoke).toHaveBeenCalledWith('detect_git_bash');
    expect(result).toBe('C:\\Program Files\\Git\\bin\\bash.exe');
  });

  it('detectGitBash returns null when not found', async () => {
    mockInvoke.mockResolvedValue(null);
    const result = await tauriService.detectGitBash();
    expect(result).toBeNull();
  });

  it('listSystemFonts invokes the correct command', async () => {
    mockInvoke.mockResolvedValue([{ family: 'Consolas' }]);
    const result = await tauriService.listSystemFonts();
    expect(mockInvoke).toHaveBeenCalledWith('list_system_fonts');
    expect(result).toEqual([{ family: 'Consolas' }]);
  });

  it('setWindowSize invokes with width and height', async () => {
    mockInvoke.mockResolvedValue(undefined);
    await tauriService.setWindowSize(1024, 768);
    expect(mockInvoke).toHaveBeenCalledWith('set_window_size', { width: 1024, height: 768 });
  });

  it('focusWindow invokes the correct command', async () => {
    mockInvoke.mockResolvedValue(undefined);
    await tauriService.focusWindow();
    expect(mockInvoke).toHaveBeenCalledWith('focus_window');
  });

  it('showContextMenu invokes with items', async () => {
    const items = [{ id: 'copy', label: 'Copy' }];
    mockInvoke.mockResolvedValue(null);
    const result = await tauriService.showContextMenu(items);
    expect(mockInvoke).toHaveBeenCalledWith('show_context_menu', { items });
    expect(result).toBeNull();
  });

  it('openDebugLogFolder invokes the correct command', async () => {
    mockInvoke.mockResolvedValue(undefined);
    await tauriService.openDebugLogFolder();
    expect(mockInvoke).toHaveBeenCalledWith('open_debug_log_folder');
  });
});

describe('tauriService DPAPI commands', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it('dpapiEncrypt invokes with plaintext', async () => {
    mockInvoke.mockResolvedValue('[SAFE]abc123');
    const result = await tauriService.dpapiEncrypt('secret');
    expect(mockInvoke).toHaveBeenCalledWith('dpapi_encrypt', { plaintext: 'secret' });
    expect(result).toBe('[SAFE]abc123');
  });

  it('dpapiDecrypt invokes with ciphertext', async () => {
    mockInvoke.mockResolvedValue('secret');
    const result = await tauriService.dpapiDecrypt('[SAFE]abc123');
    expect(mockInvoke).toHaveBeenCalledWith('dpapi_decrypt', { ciphertext: '[SAFE]abc123' });
    expect(result).toBe('secret');
  });

  it('dpapiEncryptBatch invokes with values array', async () => {
    mockInvoke.mockResolvedValue(['[SAFE]a', '[SAFE]b']);
    const result = await tauriService.dpapiEncryptBatch(['x', 'y']);
    expect(mockInvoke).toHaveBeenCalledWith('dpapi_encrypt_batch', { values: ['x', 'y'] });
    expect(result).toEqual(['[SAFE]a', '[SAFE]b']);
  });

  it('dpapiDecryptBatch invokes with values array', async () => {
    mockInvoke.mockResolvedValue(['x', 'y']);
    const result = await tauriService.dpapiDecryptBatch(['[SAFE]a', '[SAFE]b']);
    expect(mockInvoke).toHaveBeenCalledWith('dpapi_decrypt_batch', { values: ['[SAFE]a', '[SAFE]b'] });
    expect(result).toEqual(['x', 'y']);
  });

  it('dpapiVerifyUser invokes with password', async () => {
    mockInvoke.mockResolvedValue(true);
    const result = await tauriService.dpapiVerifyUser('pass123');
    expect(mockInvoke).toHaveBeenCalledWith('dpapi_verify_user', { password: 'pass123' });
    expect(result).toBe(true);
  });
});

describe('tauriService logging commands', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it('logDebug invokes with level, category, and message', async () => {
    mockInvoke.mockResolvedValue(undefined);
    await tauriService.logDebug('info', 'app', 'started');
    expect(mockInvoke).toHaveBeenCalledWith('log_debug', {
      level: 'info',
      category: 'app',
      message: 'started',
    });
  });

  it('updateLogging invokes with level', async () => {
    mockInvoke.mockResolvedValue(undefined);
    await tauriService.updateLogging('debug');
    expect(mockInvoke).toHaveBeenCalledWith('update_logging', { level: 'debug' });
  });
});

describe('tauriService file dialog commands', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it('selectImage invokes the correct command', async () => {
    mockInvoke.mockResolvedValue('/path/to/image.png');
    const result = await tauriService.selectImage();
    expect(mockInvoke).toHaveBeenCalledWith('select_image');
    expect(result).toBe('/path/to/image.png');
  });

  it('selectImage returns null when cancelled', async () => {
    mockInvoke.mockResolvedValue(null);
    const result = await tauriService.selectImage();
    expect(result).toBeNull();
  });

  it('selectFolder invokes the correct command', async () => {
    mockInvoke.mockResolvedValue('/path/to/folder');
    const result = await tauriService.selectFolder();
    expect(mockInvoke).toHaveBeenCalledWith('select_folder');
    expect(result).toBe('/path/to/folder');
  });

  it('selectFolder returns null when cancelled', async () => {
    mockInvoke.mockResolvedValue(null);
    const result = await tauriService.selectFolder();
    expect(result).toBeNull();
  });
});

describe('tauriService theme commands', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it('getThemes invokes the correct command', async () => {
    const themes = {
      dark: { name: 'Dark', variables: { 'bg-primary': '#000' }, terminal: { foreground: '#fff', background: '#000', backgroundInactive: '#000', paneBackground: '#000' } },
    };
    mockInvoke.mockResolvedValue(themes);
    const result = await tauriService.getThemes();
    expect(mockInvoke).toHaveBeenCalledWith('get_themes');
    expect(result).toEqual(themes);
  });

  it('saveCustomTheme invokes with key and data', async () => {
    const themeData = {
      name: 'My Theme',
      variables: { 'bg-primary': '#111' },
      terminal: { foreground: '#fff', background: '#000', backgroundInactive: '#000', paneBackground: '#000' },
    };
    mockInvoke.mockResolvedValue({ success: true });
    const result = await tauriService.saveCustomTheme('my-theme', themeData);
    expect(mockInvoke).toHaveBeenCalledWith('save_custom_theme', { themeKey: 'my-theme', themeData });
    expect(result).toEqual({ success: true });
  });

  it('deleteCustomTheme invokes with key', async () => {
    mockInvoke.mockResolvedValue({ success: true });
    const result = await tauriService.deleteCustomTheme('old-theme');
    expect(mockInvoke).toHaveBeenCalledWith('delete_custom_theme', { themeKey: 'old-theme' });
    expect(result).toEqual({ success: true });
  });
});

describe('tauriService session logging commands', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it('updateSessionLogging invokes with loggingEnabled and loggingPath', async () => {
    mockInvoke.mockResolvedValue(undefined);
    await tauriService.updateSessionLogging(true, 'C:\\logs');
    expect(mockInvoke).toHaveBeenCalledWith('update_session_logging', {
      loggingEnabled: true,
      loggingPath: 'C:\\logs',
    });
  });
});

describe('tauriService log viewer commands', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it('listLogFiles invokes with folderPath', async () => {
    const result = { files: [{ name: 'test.txt', path: '/logs/test.txt', mtime: 1700000000000, size: 1024 }] };
    mockInvoke.mockResolvedValue(result);
    const res = await tauriService.listLogFiles('/logs');
    expect(mockInvoke).toHaveBeenCalledWith('list_log_files', { folderPath: '/logs' });
    expect(res).toEqual(result);
  });

  it('listLogFiles handles error response', async () => {
    const result = { error: 'access denied' };
    mockInvoke.mockResolvedValue(result);
    const res = await tauriService.listLogFiles('/forbidden');
    expect(res).toEqual(result);
  });

  it('readLogFile invokes with filePath', async () => {
    const result = { content: 'log content here' };
    mockInvoke.mockResolvedValue(result);
    const res = await tauriService.readLogFile('/logs/test.txt');
    expect(mockInvoke).toHaveBeenCalledWith('read_log_file', { filePath: '/logs/test.txt' });
    expect(res).toEqual(result);
  });

  it('readLogFile handles error response', async () => {
    const result = { error: 'file too large' };
    mockInvoke.mockResolvedValue(result);
    const res = await tauriService.readLogFile('/logs/huge.txt');
    expect(res).toEqual(result);
  });
});

describe('tauriService host tree commands', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it('exportHtree invokes with data and password', async () => {
    mockInvoke.mockResolvedValue({ success: true });
    const result = await tauriService.exportHtree('[{"id":"1"}]', 'pass');
    expect(mockInvoke).toHaveBeenCalledWith('export_htree', {
      data: '[{"id":"1"}]',
      password: 'pass',
    });
    expect(result).toEqual({ success: true });
  });

  it('exportHtree handles cancellation', async () => {
    mockInvoke.mockResolvedValue({ success: false, error: 'export cancelled' });
    const result = await tauriService.exportHtree('[]', 'pass');
    expect(result).toEqual({ success: false, error: 'export cancelled' });
  });

  it('selectImportFile invokes the correct command', async () => {
    mockInvoke.mockResolvedValue('/path/to/hosts.htree');
    const result = await tauriService.selectImportFile();
    expect(mockInvoke).toHaveBeenCalledWith('select_import_file');
    expect(result).toBe('/path/to/hosts.htree');
  });

  it('selectImportFile returns null when cancelled', async () => {
    mockInvoke.mockResolvedValue(null);
    const result = await tauriService.selectImportFile();
    expect(result).toBeNull();
  });

  it('decryptImportFile invokes with password', async () => {
    const json = '[{"id":"1","type":"folder","name":"Test"}]';
    mockInvoke.mockResolvedValue(json);
    const result = await tauriService.decryptImportFile('mypass');
    expect(mockInvoke).toHaveBeenCalledWith('decrypt_import_file', { password: 'mypass' });
    expect(result).toBe(json);
  });
});

describe('tauriService SSH algorithm commands', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it('getSshAlgorithms invokes the correct command', async () => {
    const algorithms = {
      kex: [{ name: 'curve25519-sha256', enabled: true }],
      cipher: [{ name: 'aes256-ctr', enabled: true }],
    };
    mockInvoke.mockResolvedValue(algorithms);
    const result = await tauriService.getSshAlgorithms();
    expect(mockInvoke).toHaveBeenCalledWith('get_ssh_algorithms');
    expect(result).toEqual(algorithms);
  });

  it('saveSshAlgorithms invokes with algorithms data', async () => {
    const algorithms = {
      kex: [{ name: 'curve25519-sha256', enabled: true }],
      cipher: [{ name: 'aes256-ctr', enabled: false }],
      serverHostKey: [{ name: 'ssh-ed25519', enabled: true }],
      hmac: [{ name: 'hmac-sha2-256', enabled: true }],
    };
    mockInvoke.mockResolvedValue(true);
    const result = await tauriService.saveSshAlgorithms(algorithms);
    expect(mockInvoke).toHaveBeenCalledWith('save_ssh_algorithms', { algorithms });
    expect(result).toBe(true);
  });
});

describe('tauriService text editor commands', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it('textEditorOpenFile invokes the correct command', async () => {
    mockInvoke.mockResolvedValue('/path/to/file.txt');
    const result = await tauriService.textEditorOpenFile();
    expect(mockInvoke).toHaveBeenCalledWith('text_editor_open_file');
    expect(result).toBe('/path/to/file.txt');
  });

  it('textEditorOpenFile returns null when cancelled', async () => {
    mockInvoke.mockResolvedValue(null);
    const result = await tauriService.textEditorOpenFile();
    expect(result).toBeNull();
  });

  it('textEditorSaveFile invokes with defaultPath', async () => {
    mockInvoke.mockResolvedValue('/path/to/save.txt');
    const result = await tauriService.textEditorSaveFile('save.txt');
    expect(mockInvoke).toHaveBeenCalledWith('text_editor_save_file', { defaultPath: 'save.txt' });
    expect(result).toBe('/path/to/save.txt');
  });

  it('textEditorSaveFile sends null when no defaultPath', async () => {
    mockInvoke.mockResolvedValue('/path/to/file.txt');
    await tauriService.textEditorSaveFile();
    expect(mockInvoke).toHaveBeenCalledWith('text_editor_save_file', { defaultPath: null });
  });

  it('textEditorReadFile invokes with filePath and encoding', async () => {
    const result = { content: 'hello', lineEnding: 'LF' };
    mockInvoke.mockResolvedValue(result);
    const res = await tauriService.textEditorReadFile('/file.txt', 'utf-8');
    expect(mockInvoke).toHaveBeenCalledWith('text_editor_read_file', { filePath: '/file.txt', encoding: 'utf-8' });
    expect(res).toEqual(result);
  });

  it('textEditorWriteFile invokes with filePath, content, and encoding', async () => {
    mockInvoke.mockResolvedValue(true);
    const result = await tauriService.textEditorWriteFile('/file.txt', 'content', 'utf-8');
    expect(mockInvoke).toHaveBeenCalledWith('text_editor_write_file', { filePath: '/file.txt', content: 'content', encoding: 'utf-8' });
    expect(result).toBe(true);
  });

  it('textEditorApproveDroppedFile invokes with filePath', async () => {
    mockInvoke.mockResolvedValue(true);
    const result = await tauriService.textEditorApproveDroppedFile('/dropped.txt');
    expect(mockInvoke).toHaveBeenCalledWith('text_editor_approve_dropped_file', { filePath: '/dropped.txt' });
    expect(result).toBe(true);
  });
});

describe('tauriService file explorer commands', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it('fileExplorerListDirectory invokes with dirPath', async () => {
    const result = { entries: [{ name: 'test.txt', isDirectory: false, size: 100, mtime: 1700000000, isHidden: false }] };
    mockInvoke.mockResolvedValue(result);
    const res = await tauriService.fileExplorerListDirectory('/dir');
    expect(mockInvoke).toHaveBeenCalledWith('file_explorer_list_directory', { dirPath: '/dir' });
    expect(res).toEqual(result);
  });

  it('fileExplorerListDirectory handles error response', async () => {
    const result = { error: 'permission denied' };
    mockInvoke.mockResolvedValue(result);
    const res = await tauriService.fileExplorerListDirectory('/forbidden');
    expect(res).toEqual(result);
  });

  it('fileExplorerGetDrives invokes the correct command', async () => {
    const result = { drives: ['C:\\', 'D:\\'], homedir: 'C:\\Users\\test' };
    mockInvoke.mockResolvedValue(result);
    const res = await tauriService.fileExplorerGetDrives();
    expect(mockInvoke).toHaveBeenCalledWith('file_explorer_get_drives');
    expect(res).toEqual(result);
  });
});

describe('tauriService ping monitor commands', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it('pingMonitorStart invokes with all parameters', async () => {
    mockInvoke.mockResolvedValue(undefined);
    await tauriService.pingMonitorStart('s1', ['google.com'], 5000, true, '/logs');
    expect(mockInvoke).toHaveBeenCalledWith('ping_monitor_start', {
      sessionId: 's1',
      targets: ['google.com'],
      intervalMs: 5000,
      loggingEnabled: true,
      loggingPath: '/logs',
    });
  });

  it('pingMonitorStop invokes with sessionId', async () => {
    mockInvoke.mockResolvedValue(undefined);
    await tauriService.pingMonitorStop('s1');
    expect(mockInvoke).toHaveBeenCalledWith('ping_monitor_stop', { sessionId: 's1' });
  });

  it('pingMonitorUpdateTargets invokes with sessionId and targets', async () => {
    mockInvoke.mockResolvedValue(undefined);
    await tauriService.pingMonitorUpdateTargets('s1', ['8.8.8.8']);
    expect(mockInvoke).toHaveBeenCalledWith('ping_monitor_update_targets', {
      sessionId: 's1',
      targets: ['8.8.8.8'],
    });
  });

  it('pingMonitorUpdateInterval invokes with sessionId and intervalMs', async () => {
    mockInvoke.mockResolvedValue(undefined);
    await tauriService.pingMonitorUpdateInterval('s1', 10000);
    expect(mockInvoke).toHaveBeenCalledWith('ping_monitor_update_interval', {
      sessionId: 's1',
      intervalMs: 10000,
    });
  });
});

describe('tauriService GCE IAP tunnel commands', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it('gceIapCheckGcloud invokes the correct command', async () => {
    const status = { available: true, version: '456.0.0' };
    mockInvoke.mockResolvedValue(status);
    const result = await tauriService.gceIapCheckGcloud();
    expect(mockInvoke).toHaveBeenCalledWith('gce_iap_check_gcloud');
    expect(result).toEqual(status);
  });

  it('gceIapCheckGcloud handles unavailable', async () => {
    const status = { available: false };
    mockInvoke.mockResolvedValue(status);
    const result = await tauriService.gceIapCheckGcloud();
    expect(result).toEqual(status);
  });

  it('gceIapCheckAuth invokes the correct command', async () => {
    const auth = { authenticated: true, account: 'user@example.com' };
    mockInvoke.mockResolvedValue(auth);
    const result = await tauriService.gceIapCheckAuth();
    expect(mockInvoke).toHaveBeenCalledWith('gce_iap_check_auth');
    expect(result).toEqual(auth);
  });

  it('gceIapCheckAuth handles unauthenticated', async () => {
    const auth = { authenticated: false };
    mockInvoke.mockResolvedValue(auth);
    const result = await tauriService.gceIapCheckAuth();
    expect(result).toEqual(auth);
  });

  it('gceIapListProjects invokes the correct command', async () => {
    const projects = [
      { id: 'proj-a', name: 'Project A' },
      { id: 'proj-b', name: 'Project B' },
    ];
    mockInvoke.mockResolvedValue(projects);
    const result = await tauriService.gceIapListProjects();
    expect(mockInvoke).toHaveBeenCalledWith('gce_iap_list_projects');
    expect(result).toEqual(projects);
  });

  it('gceIapListZones invokes with project', async () => {
    const zones = ['us-central1-a', 'us-east1-b'];
    mockInvoke.mockResolvedValue(zones);
    const result = await tauriService.gceIapListZones('my-project-123');
    expect(mockInvoke).toHaveBeenCalledWith('gce_iap_list_zones', { project: 'my-project-123' });
    expect(result).toEqual(zones);
  });

  it('gceIapListInstances invokes with project and zone', async () => {
    const instances = [
      { name: 'vm-web-01', status: 'RUNNING' },
      { name: 'vm-db-01', status: 'TERMINATED' },
    ];
    mockInvoke.mockResolvedValue(instances);
    const result = await tauriService.gceIapListInstances('my-project-123', 'us-central1-a');
    expect(mockInvoke).toHaveBeenCalledWith('gce_iap_list_instances', {
      project: 'my-project-123',
      zone: 'us-central1-a',
    });
    expect(result).toEqual(instances);
  });
});

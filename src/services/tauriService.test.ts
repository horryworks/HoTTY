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

import { listen } from '@tauri-apps/api/event';
import { tauriService, isEncrypted } from './tauriService';

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

  it('logDebug redacts credential-like fields before forwarding', async () => {
    mockInvoke.mockResolvedValue(undefined);
    await tauriService.logDebug('error', 'auth', 'login failed: password=hunter2 token=abc');
    const callArgs = mockInvoke.mock.calls[0][1] as { message: string };
    expect(callArgs.message).not.toContain('hunter2');
    expect(callArgs.message).not.toContain('abc');
    expect(callArgs.message).toContain('<redacted>');
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

  it('confirmLogDir invokes confirm_log_dir with the path', async () => {
    mockInvoke.mockResolvedValue(true);
    const result = await tauriService.confirmLogDir('/tmp/logs');
    expect(mockInvoke).toHaveBeenCalledWith('confirm_log_dir', { path: '/tmp/logs' });
    expect(result).toBe(true);
  });

  it('confirmLogDir returns false when the user declines', async () => {
    mockInvoke.mockResolvedValue(false);
    const result = await tauriService.confirmLogDir('/tmp/logs');
    expect(result).toBe(false);
  });

  it('openExternal forwards the URL to open_external', async () => {
    mockInvoke.mockResolvedValue(undefined);
    await tauriService.openExternal('https://github.com/horryworks/HoTTY');
    expect(mockInvoke).toHaveBeenCalledWith('open_external', {
      url: 'https://github.com/horryworks/HoTTY',
    });
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

describe('tauriService AI chat log commands', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it('aiChatLogAppend invokes with logKey, logDir, meta and turns', async () => {
    mockInvoke.mockResolvedValue(undefined);
    const meta = { title: 'router-a', model: 'gemini-2.5-pro', provider: 'gemini', terminals: ['router-a'] };
    const turns = [{ role: 'user' as const, content: 'show version' }];
    await tauriService.aiChatLogAppend('ai-1::t1', '/logs', meta, turns);
    expect(mockInvoke).toHaveBeenCalledWith('ai_chat_log_append', {
      logKey: 'ai-1::t1',
      logDir: '/logs',
      meta,
      turns,
    });
  });

  it('aiChatLogAppend sends image metadata without a base64 payload', async () => {
    mockInvoke.mockResolvedValue(undefined);
    const meta = { title: '', model: 'm', provider: 'gemini', terminals: [] };
    const turns = [
      { role: 'user' as const, content: 'look', images: [{ mimeType: 'image/png', bytes: 300 }] },
    ];
    await tauriService.aiChatLogAppend('ai-1::t1', '/logs', meta, turns);
    expect(JSON.stringify(mockInvoke.mock.calls[0][1])).not.toContain('dataBase64');
  });

  it('aiChatLogClose invokes with logKey', async () => {
    mockInvoke.mockResolvedValue(undefined);
    await tauriService.aiChatLogClose('ai-1::t1');
    expect(mockInvoke).toHaveBeenCalledWith('ai_chat_log_close', { logKey: 'ai-1::t1' });
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

describe('isEncrypted', () => {
  it('returns true for DPAPI-prefixed strings', () => {
    expect(isEncrypted('[DPAPI]abc123')).toBe(true);
  });

  it('returns true for SAFE-prefixed strings', () => {
    expect(isEncrypted('[SAFE]xyz789')).toBe(true);
  });

  it('returns false for plaintext strings', () => {
    expect(isEncrypted('plaintext')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isEncrypted('')).toBe(false);
  });

  it('returns false for partial prefix', () => {
    expect(isEncrypted('[DPAP')).toBe(false);
    expect(isEncrypted('[SAF')).toBe(false);
  });
});

describe('tauriService AI commands', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it('aiAuthStart invokes with credentials', async () => {
    mockInvoke.mockResolvedValue(true);
    const result = await tauriService.aiAuthStart({ apiKey: 'sk-test' });
    expect(mockInvoke).toHaveBeenCalledWith('ai_auth_start', { credentials: { apiKey: 'sk-test' } });
    expect(result).toBe(true);
  });

  it('aiAuthAuto invokes with credentials', async () => {
    mockInvoke.mockResolvedValue(false);
    const result = await tauriService.aiAuthAuto({});
    expect(mockInvoke).toHaveBeenCalledWith('ai_auth_auto', { credentials: {} });
    expect(result).toBe(false);
  });

  it('aiAuthStatus invokes the correct command', async () => {
    mockInvoke.mockResolvedValue({ authenticated: true });
    const result = await tauriService.aiAuthStatus();
    expect(mockInvoke).toHaveBeenCalledWith('ai_auth_status');
    expect(result).toEqual({ authenticated: true });
  });

  it('aiAuthLogout invokes the correct command', async () => {
    mockInvoke.mockResolvedValue(undefined);
    await tauriService.aiAuthLogout();
    expect(mockInvoke).toHaveBeenCalledWith('ai_auth_logout');
  });

  it('aiChatSend invokes with all parameters', async () => {
    mockInvoke.mockResolvedValue(undefined);
    await tauriService.aiChatSend('s1', 'hello', 'gpt-4o', 'Be helpful');
    expect(mockInvoke).toHaveBeenCalledWith('ai_chat_send', {
      sessionId: 's1',
      message: 'hello',
      model: 'gpt-4o',
      systemInstruction: 'Be helpful',
      images: null,
    });
  });

  it('aiChatSend sends null for missing systemInstruction', async () => {
    mockInvoke.mockResolvedValue(undefined);
    await tauriService.aiChatSend('s1', 'hello', 'gpt-4o');
    expect(mockInvoke).toHaveBeenCalledWith('ai_chat_send', {
      sessionId: 's1',
      message: 'hello',
      model: 'gpt-4o',
      systemInstruction: null,
      images: null,
    });
  });

  it('aiChatSend forwards images when provided', async () => {
    mockInvoke.mockResolvedValue(undefined);
    const images = [{ mimeType: 'image/png', dataBase64: 'AAAA' }];
    await tauriService.aiChatSend('s1', 'look', 'gpt-4o', undefined, images);
    expect(mockInvoke).toHaveBeenCalledWith('ai_chat_send', {
      sessionId: 's1',
      message: 'look',
      model: 'gpt-4o',
      systemInstruction: null,
      images,
    });
  });

  it('aiChatSend sends null images for an empty array', async () => {
    mockInvoke.mockResolvedValue(undefined);
    await tauriService.aiChatSend('s1', 'hello', 'gpt-4o', 'Be helpful', []);
    expect(mockInvoke).toHaveBeenCalledWith('ai_chat_send', {
      sessionId: 's1',
      message: 'hello',
      model: 'gpt-4o',
      systemInstruction: 'Be helpful',
      images: null,
    });
  });

  it('aiChatCancel invokes with sessionId', async () => {
    mockInvoke.mockResolvedValue(undefined);
    await tauriService.aiChatCancel('s1');
    expect(mockInvoke).toHaveBeenCalledWith('ai_chat_cancel', { sessionId: 's1' });
  });

  it('aiChatClear invokes with sessionId', async () => {
    mockInvoke.mockResolvedValue(undefined);
    await tauriService.aiChatClear('s1');
    expect(mockInvoke).toHaveBeenCalledWith('ai_chat_clear', { sessionId: 's1' });
  });

  it('aiListModels invokes the correct command', async () => {
    const models = [{ name: 'gpt-4o', displayName: 'GPT-4o' }];
    mockInvoke.mockResolvedValue(models);
    const result = await tauriService.aiListModels();
    expect(mockInvoke).toHaveBeenCalledWith('ai_list_models');
    expect(result).toEqual(models);
  });

  it('aiListLocations invokes the correct command', async () => {
    mockInvoke.mockResolvedValue(['us-central1', 'europe-west1']);
    const result = await tauriService.aiListLocations();
    expect(mockInvoke).toHaveBeenCalledWith('ai_list_locations');
    expect(result).toEqual(['us-central1', 'europe-west1']);
  });

  it('aiSetProvider invokes with providerId', async () => {
    mockInvoke.mockResolvedValue(undefined);
    await tauriService.aiSetProvider('anthropic');
    expect(mockInvoke).toHaveBeenCalledWith('ai_set_provider', { providerId: 'anthropic' });
  });

  it('aiSetLocation invokes with location', async () => {
    mockInvoke.mockResolvedValue(undefined);
    await tauriService.aiSetLocation('us-east1');
    expect(mockInvoke).toHaveBeenCalledWith('ai_set_location', { location: 'us-east1' });
  });

  it('selectServiceAccountKeyFile invokes the correct command', async () => {
    mockInvoke.mockResolvedValue('/path/to/key.json');
    const result = await tauriService.selectServiceAccountKeyFile();
    expect(mockInvoke).toHaveBeenCalledWith('select_service_account_key_file');
    expect(result).toBe('/path/to/key.json');
  });

  it('selectServiceAccountKeyFile returns null when cancelled', async () => {
    mockInvoke.mockResolvedValue(null);
    const result = await tauriService.selectServiceAccountKeyFile();
    expect(result).toBeNull();
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

describe('tauriService web browser wrappers', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockInvoke.mockResolvedValue(undefined);
  });

  it('webBrowserClearBrowsingData forwards the pane id and selected options', async () => {
    const options = {
      cookiesAndSiteData: true,
      cache: true,
      history: false,
      passwords: false,
      autofill: true,
    };
    await tauriService.webBrowserClearBrowsingData('wb-pane-1', options);
    expect(mockInvoke).toHaveBeenCalledWith('web_browser_clear_browsing_data', {
      paneId: 'wb-pane-1',
      options,
    });
  });
});

describe('tauriService event listeners', () => {
  const listenMock = vi.mocked(listen);

  beforeEach(() => {
    listenMock.mockReset();
  });

  it('onSshKnownHostsWarning subscribes to ssh-known-hosts-warning and forwards the message', async () => {
    let captured: ((e: { payload: string }) => void) | undefined;
    const unlisten = vi.fn();
    listenMock.mockImplementation((_event, handler) => {
      captured = handler as (e: { payload: string }) => void;
      return Promise.resolve(unlisten);
    });

    const cb = vi.fn();
    const result = await tauriService.onSshKnownHostsWarning(cb);

    expect(listenMock).toHaveBeenCalledWith('ssh-known-hosts-warning', expect.any(Function));
    expect(result).toBe(unlisten);

    const message = 'Could not save host key for example.com:22 to known_hosts: permission denied';
    captured?.({ payload: message });
    expect(cb).toHaveBeenCalledWith(message);
  });
});

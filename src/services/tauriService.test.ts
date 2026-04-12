import { describe, it, expect, vi, beforeEach } from 'vitest';

const writeText = vi.fn();
const readText = vi.fn();

vi.mock('@tauri-apps/plugin-clipboard-manager', () => ({
  writeText: (t: string) => writeText(t),
  readText: () => readText(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));

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

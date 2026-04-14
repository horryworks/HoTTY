import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useThemes } from './useThemes';
import { tauriService } from '../services/tauriService';
import { DEFAULT_THEMES } from '../themes/defaults';
import type { Theme } from '../types/appTypes';

vi.mock('../services/tauriService', () => ({
  tauriService: {
    getThemes: vi.fn(),
    saveCustomTheme: vi.fn(),
    deleteCustomTheme: vi.fn(),
  },
}));

const makeTheme = (name: string): Theme => ({
  name,
  variables: { 'bg-primary': '#123456' },
  terminal: {
    foreground: '#ffffff',
    background: '#000000',
    backgroundInactive: '#111111',
    paneBackground: '#222222',
  },
});

describe('useThemes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('initial state contains built-in defaults', () => {
    vi.mocked(tauriService.getThemes).mockResolvedValue({});
    const { result } = renderHook(() => useThemes());
    expect(Object.keys(result.current.themesData).sort()).toEqual(['dark', 'light', 'medium']);
  });

  it('merges backend themes with built-in defaults', async () => {
    const custom = makeTheme('My Custom');
    vi.mocked(tauriService.getThemes).mockResolvedValue({ 'my-custom': custom });
    const { result } = renderHook(() => useThemes());
    await waitFor(() => {
      expect(result.current.themesData['my-custom']).toBeDefined();
    });
    expect(result.current.themesData.dark).toEqual(DEFAULT_THEMES.dark);
    expect(result.current.themesData['my-custom'].name).toBe('My Custom');
  });

  it('falls back to defaults if backend throws', async () => {
    vi.mocked(tauriService.getThemes).mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useThemes());
    await waitFor(() => {
      expect(vi.mocked(tauriService.getThemes)).toHaveBeenCalled();
    });
    expect(Object.keys(result.current.themesData).sort()).toEqual(['dark', 'light', 'medium']);
  });

  it('saveTheme reloads themes on success', async () => {
    vi.mocked(tauriService.getThemes).mockResolvedValue({});
    vi.mocked(tauriService.saveCustomTheme).mockResolvedValue({ success: true });
    const { result } = renderHook(() => useThemes());
    await waitFor(() => expect(vi.mocked(tauriService.getThemes)).toHaveBeenCalledTimes(1));

    vi.mocked(tauriService.getThemes).mockResolvedValue({ foo: makeTheme('Foo') });
    await act(async () => {
      await result.current.saveTheme('foo', makeTheme('Foo'));
    });
    await waitFor(() => {
      expect(result.current.themesData.foo).toBeDefined();
    });
  });

  it('saveTheme does NOT reload on failure', async () => {
    vi.mocked(tauriService.getThemes).mockResolvedValue({});
    vi.mocked(tauriService.saveCustomTheme).mockResolvedValue({ success: false, error: 'bad' });
    const { result } = renderHook(() => useThemes());
    await waitFor(() => expect(vi.mocked(tauriService.getThemes)).toHaveBeenCalledTimes(1));

    await act(async () => {
      const res = await result.current.saveTheme('foo', makeTheme('Foo'));
      expect(res.success).toBe(false);
    });
    expect(vi.mocked(tauriService.getThemes)).toHaveBeenCalledTimes(1);
  });

  it('deleteTheme reloads themes on success', async () => {
    vi.mocked(tauriService.getThemes).mockResolvedValue({ foo: makeTheme('Foo') });
    vi.mocked(tauriService.deleteCustomTheme).mockResolvedValue({ success: true });
    const { result } = renderHook(() => useThemes());
    await waitFor(() => {
      expect(result.current.themesData.foo).toBeDefined();
    });

    vi.mocked(tauriService.getThemes).mockResolvedValue({});
    await act(async () => {
      await result.current.deleteTheme('foo');
    });
    await waitFor(() => {
      expect(result.current.themesData.foo).toBeUndefined();
    });
  });
});

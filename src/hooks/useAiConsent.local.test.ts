import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

const aiAuthStatus = vi.fn();
vi.mock('../services/tauriService', () => ({
  tauriService: { aiAuthStatus: (...a: unknown[]) => aiAuthStatus(...a) },
}));

import { useAiConsent } from './useAiConsent';
import { useSettingsStore } from '../stores/settingsStore';

describe('useAiConsent with the local AI server', () => {
  beforeEach(() => {
    useSettingsStore.getState().reset();
    useSettingsStore.getState().update('activeAiProvider', 'local');
    aiAuthStatus.mockReset();
  });

  it('never asks for a server on this PC', async () => {
    aiAuthStatus.mockResolvedValue({ authenticated: true, accountInfo: 'http://localhost:11434' });
    const { result } = renderHook(() => useAiConsent());
    let ok: boolean | undefined;
    await act(async () => { ok = await result.current.ensureAiConsent(); });
    expect(ok).toBe(true);
    expect(result.current.aiConsentOpen).toBe(false);
  });

  it('asks once per host for a server on another machine, and remembers it', async () => {
    aiAuthStatus.mockResolvedValue({ authenticated: true, accountInfo: 'http://192.0.2.10:8080' });
    const { result } = renderHook(() => useAiConsent());

    let promise!: Promise<boolean>;
    act(() => { promise = result.current.ensureAiConsent(); });
    await waitFor(() => expect(result.current.aiConsentOpen).toBe(true));
    expect(result.current.aiConsentHost).toBe('192.0.2.10:8080');

    act(() => { result.current.handleAiConsentAccept(); });
    await expect(promise).resolves.toBe(true);
    expect(useSettingsStore.getState().aiLocalConsentHosts).toEqual(['192.0.2.10:8080']);
    // The cloud notice is a separate consent.
    expect(useSettingsStore.getState().aiDataConsentAccepted).toBe(false);

    let again: boolean | undefined;
    await act(async () => { again = await result.current.ensureAiConsent(); });
    expect(again).toBe(true);
    expect(result.current.aiConsentOpen).toBe(false);
  });

  it('does not carry the cloud consent over to a LAN server', async () => {
    useSettingsStore.getState().update('aiDataConsentAccepted', true);
    aiAuthStatus.mockResolvedValue({ authenticated: true, accountInfo: 'http://192.0.2.10:8080' });
    const { result } = renderHook(() => useAiConsent());
    let promise!: Promise<boolean>;
    act(() => { promise = result.current.ensureAiConsent(); });
    await waitFor(() => expect(result.current.aiConsentOpen).toBe(true));
    act(() => { result.current.handleAiConsentCancel(); });
    await expect(promise).resolves.toBe(false);
    expect(useSettingsStore.getState().aiLocalConsentHosts).toEqual([]);
  });
});

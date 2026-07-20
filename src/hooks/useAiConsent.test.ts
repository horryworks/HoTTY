import { describe, it, expect, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useAiConsent } from './useAiConsent';
import { useSettingsStore } from '../stores/settingsStore';

describe('useAiConsent', () => {
  beforeEach(() => {
    useSettingsStore.getState().reset();
  });

  it('resolves immediately without opening the modal when consent was already accepted', async () => {
    useSettingsStore.getState().update('aiDataConsentAccepted', true);
    const { result } = renderHook(() => useAiConsent());

    let resolved: boolean | undefined;
    await act(async () => {
      resolved = await result.current.ensureAiConsent();
    });

    expect(resolved).toBe(true);
    expect(result.current.aiConsentOpen).toBe(false);
  });

  it('opens the modal and resolves true on accept (persisting consent)', async () => {
    const { result } = renderHook(() => useAiConsent());

    let promise!: Promise<boolean>;
    act(() => {
      promise = result.current.ensureAiConsent();
    });
    expect(result.current.aiConsentOpen).toBe(true);
    expect(useSettingsStore.getState().aiDataConsentAccepted).toBe(false);

    act(() => {
      result.current.handleAiConsentAccept();
    });

    await expect(promise).resolves.toBe(true);
    expect(result.current.aiConsentOpen).toBe(false);
    expect(useSettingsStore.getState().aiDataConsentAccepted).toBe(true);
  });

  it('opens the modal and resolves false on cancel (no persistence)', async () => {
    const { result } = renderHook(() => useAiConsent());

    let promise!: Promise<boolean>;
    act(() => {
      promise = result.current.ensureAiConsent();
    });
    expect(result.current.aiConsentOpen).toBe(true);

    act(() => {
      result.current.handleAiConsentCancel();
    });

    await expect(promise).resolves.toBe(false);
    expect(result.current.aiConsentOpen).toBe(false);
    expect(useSettingsStore.getState().aiDataConsentAccepted).toBe(false);
  });

  it('resolves ALL concurrent waiters together on a single accept', async () => {
    const { result } = renderHook(() => useAiConsent());

    let p1!: Promise<boolean>;
    let p2!: Promise<boolean>;
    act(() => {
      p1 = result.current.ensureAiConsent();
      p2 = result.current.ensureAiConsent();
    });
    expect(result.current.aiConsentOpen).toBe(true);

    act(() => {
      result.current.handleAiConsentAccept();
    });

    await expect(Promise.all([p1, p2])).resolves.toEqual([true, true]);
  });

  it('after acceptance, a later ensureAiConsent short-circuits to true', async () => {
    const { result } = renderHook(() => useAiConsent());

    let p1!: Promise<boolean>;
    act(() => {
      p1 = result.current.ensureAiConsent();
    });
    act(() => {
      result.current.handleAiConsentAccept();
    });
    await expect(p1).resolves.toBe(true);

    // A subsequent call must not re-open the modal.
    let resolved: boolean | undefined;
    await act(async () => {
      resolved = await result.current.ensureAiConsent();
    });
    expect(resolved).toBe(true);
    expect(result.current.aiConsentOpen).toBe(false);
  });
});

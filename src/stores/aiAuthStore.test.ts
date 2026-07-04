import { describe, it, expect, beforeEach } from 'vitest';
import { useAiAuthStore } from './aiAuthStore';

beforeEach(() => {
  useAiAuthStore.setState({ isAuthenticated: false, isAuthLoading: false, authError: null, logoutNonce: 0 });
});

describe('aiAuthStore', () => {
  it('starts signed out and idle', () => {
    const s = useAiAuthStore.getState();
    expect(s.isAuthenticated).toBe(false);
    expect(s.isAuthLoading).toBe(false);
    expect(s.authError).toBeNull();
  });

  it('applyAuthResult(true) authenticates, stops loading, and clears a stale error', () => {
    useAiAuthStore.setState({ isAuthLoading: true, authError: 'timedOut' });
    useAiAuthStore.getState().applyAuthResult(true);
    const s = useAiAuthStore.getState();
    expect(s.isAuthenticated).toBe(true);
    expect(s.isAuthLoading).toBe(false);
    expect(s.authError).toBeNull();
  });

  it('applyAuthResult(false) records a failure', () => {
    useAiAuthStore.setState({ isAuthLoading: true });
    useAiAuthStore.getState().applyAuthResult(false);
    const s = useAiAuthStore.getState();
    expect(s.isAuthenticated).toBe(false);
    expect(s.isAuthLoading).toBe(false);
    expect(s.authError).toBe('failed');
  });

  it('resetAuth returns to the signed-out idle state without bumping logoutNonce', () => {
    useAiAuthStore.setState({ isAuthenticated: true, isAuthLoading: true, authError: 'failed' });
    useAiAuthStore.getState().resetAuth();
    const s = useAiAuthStore.getState();
    expect(s.isAuthenticated).toBe(false);
    expect(s.isAuthLoading).toBe(false);
    expect(s.authError).toBeNull();
    expect(s.logoutNonce).toBe(0);
  });

  it('signalLogout resets state and bumps logoutNonce', () => {
    useAiAuthStore.setState({ isAuthenticated: true, isAuthLoading: true, authError: 'failed' });
    useAiAuthStore.getState().signalLogout();
    const s = useAiAuthStore.getState();
    expect(s.isAuthenticated).toBe(false);
    expect(s.isAuthLoading).toBe(false);
    expect(s.authError).toBeNull();
    expect(s.logoutNonce).toBe(1);
  });
});

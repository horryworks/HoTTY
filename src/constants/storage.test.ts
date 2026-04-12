import { describe, it, expect } from 'vitest';
import { STORAGE_KEYS } from './storage';

describe('STORAGE_KEYS', () => {
  it('has HOST_TREE key', () => {
    expect(STORAGE_KEYS.HOST_TREE).toBe('hotty_host_tree');
  });

  it('has AI-related keys', () => {
    expect(STORAGE_KEYS.GEMINI_CLIENT_ID).toBe('hotty_gemini_client_id');
    expect(STORAGE_KEYS.GEMINI_CLIENT_SECRET).toBe('hotty_gemini_client_secret');
    expect(STORAGE_KEYS.GEMINI_LANGUAGE).toBe('hotty_gemini_language');
    expect(STORAGE_KEYS.AI_SELECTED_MODEL).toBe('hotty_ai_selected_model');
    expect(STORAGE_KEYS.AI_EXPLICIT_LOGOUT).toBe('hotty_ai_explicit_logout');
  });
});

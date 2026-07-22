import { describe, it, expect } from 'vitest';
import { MODEL_LOAD_RETRY_DELAYS_MS } from './modelLoadRetry';

// The retry schedule gates the "Failed to retrieve the AI model list" banner:
// each entry is a backoff before the next post-sign-in fetch attempt, so the
// list must be non-empty, positive, and strictly increasing (a real backoff).
describe('MODEL_LOAD_RETRY_DELAYS_MS', () => {
  it('is a non-empty list of strictly increasing positive backoff delays', () => {
    expect(MODEL_LOAD_RETRY_DELAYS_MS.length).toBeGreaterThan(0);
    for (const d of MODEL_LOAD_RETRY_DELAYS_MS) {
      expect(d).toBeGreaterThan(0);
    }
    for (let i = 1; i < MODEL_LOAD_RETRY_DELAYS_MS.length; i++) {
      expect(MODEL_LOAD_RETRY_DELAYS_MS[i]).toBeGreaterThan(MODEL_LOAD_RETRY_DELAYS_MS[i - 1]);
    }
  });

  it('matches the documented 1s / 3s / 8s schedule', () => {
    expect(MODEL_LOAD_RETRY_DELAYS_MS).toEqual([1000, 3000, 8000]);
  });
});

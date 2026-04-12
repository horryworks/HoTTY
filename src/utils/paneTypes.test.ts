import { describe, it, expect } from 'vitest';
import {
  makeFeaturePaneId,
  getPaneContentType,
  isFeaturePane,
  getFeatureDisplayName,
  type FeaturePaneType,
} from './paneTypes';

describe('paneTypes', () => {
  describe('makeFeaturePaneId', () => {
    it('generates IDs with correct prefix for each type', () => {
      const cases: [FeaturePaneType, string][] = [
        ['log-viewer', 'lv-'],
        ['ping-monitor', 'pm-'],
        ['text-editor', 'te-'],
        ['file-explorer', 'fe-'],
      ];
      for (const [type, prefix] of cases) {
        const id = makeFeaturePaneId(type);
        expect(id.startsWith(prefix)).toBe(true);
        expect(id.length).toBeGreaterThan(prefix.length);
      }
    });

    it('generates unique IDs', () => {
      const ids = new Set(Array.from({ length: 20 }, () => makeFeaturePaneId('log-viewer')));
      expect(ids.size).toBe(20);
    });
  });

  describe('getPaneContentType', () => {
    it('returns correct type for feature pane IDs', () => {
      expect(getPaneContentType('lv-abc123')).toBe('log-viewer');
      expect(getPaneContentType('pm-xyz789')).toBe('ping-monitor');
      expect(getPaneContentType('te-def456')).toBe('text-editor');
      expect(getPaneContentType('fe-ghi012')).toBe('file-explorer');
    });

    it('returns session for session IDs', () => {
      expect(getPaneContentType('s-m1abc-xyz')).toBe('session');
    });

    it('returns session for unknown prefixes', () => {
      expect(getPaneContentType('unknown-id')).toBe('session');
    });
  });

  describe('isFeaturePane', () => {
    it('returns true for feature pane IDs', () => {
      expect(isFeaturePane('lv-abc')).toBe(true);
      expect(isFeaturePane('pm-abc')).toBe(true);
      expect(isFeaturePane('te-abc')).toBe(true);
      expect(isFeaturePane('fe-abc')).toBe(true);
    });

    it('returns false for session IDs', () => {
      expect(isFeaturePane('s-abc-def')).toBe(false);
    });
  });

  describe('getFeatureDisplayName', () => {
    it('returns display names for each type', () => {
      expect(getFeatureDisplayName('log-viewer')).toBe('Log Viewer');
      expect(getFeatureDisplayName('ping-monitor')).toBe('Ping Monitor');
      expect(getFeatureDisplayName('text-editor')).toBe('Text Editor');
      expect(getFeatureDisplayName('file-explorer')).toBe('File Explorer');
    });
  });
});

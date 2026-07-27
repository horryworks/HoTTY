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
        ['ai-chat', 'ai-'],
        ['file-server', 'fs-'],
        ['web-browser', 'wb-'],
        ['interface-traffic', 'if-'],
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
      expect(getPaneContentType('ai-def456')).toBe('ai-chat');
      expect(getPaneContentType('fs-ghi012')).toBe('file-server');
      expect(getPaneContentType('wb-jkl345')).toBe('web-browser');
      expect(getPaneContentType('if-mno678')).toBe('interface-traffic');
    });

    it('returns session for session IDs', () => {
      expect(getPaneContentType('s-m1abc-xyz')).toBe('session');
    });

    it('returns session for unknown prefixes', () => {
      expect(getPaneContentType('unknown-id')).toBe('session');
    });

    // Text Editor ('te-') and File Explorer ('fe-') were removed; their IDs must
    // degrade to 'session' rather than resolving to a pane type that no longer
    // exists, so a stale ID can never reach the renderer as a feature pane.
    it('returns session for the retired text-editor and file-explorer prefixes', () => {
      expect(getPaneContentType('te-def456')).toBe('session');
      expect(getPaneContentType('fe-ghi012')).toBe('session');
    });
  });

  describe('isFeaturePane', () => {
    it('returns true for feature pane IDs', () => {
      expect(isFeaturePane('lv-abc')).toBe(true);
      expect(isFeaturePane('pm-abc')).toBe(true);
      expect(isFeaturePane('ai-abc')).toBe(true);
      expect(isFeaturePane('fs-abc')).toBe(true);
      expect(isFeaturePane('wb-abc')).toBe(true);
      expect(isFeaturePane('if-abc')).toBe(true);
    });

    it('returns false for session IDs', () => {
      expect(isFeaturePane('s-abc-def')).toBe(false);
    });

    it('returns false for the retired text-editor and file-explorer prefixes', () => {
      expect(isFeaturePane('te-abc')).toBe(false);
      expect(isFeaturePane('fe-abc')).toBe(false);
    });
  });

  describe('getFeatureDisplayName', () => {
    it('returns display names for each type', () => {
      expect(getFeatureDisplayName('log-viewer')).toBe('Log Viewer');
      expect(getFeatureDisplayName('ping-monitor')).toBe('Ping Monitor');
      expect(getFeatureDisplayName('ai-chat')).toBe('AI Chat');
      expect(getFeatureDisplayName('file-server')).toBe('File Server');
      expect(getFeatureDisplayName('web-browser')).toBe('Web Browser');
      expect(getFeatureDisplayName('interface-traffic')).toBe('Interface Traffic');
    });
  });
});

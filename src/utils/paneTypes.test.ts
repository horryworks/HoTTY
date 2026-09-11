import { describe, it, expect } from 'vitest';
import {
  makeFeaturePaneId,
  getPaneContentType,
  isFeaturePane,
  FEATURE_LABEL_KEYS,
  makeWorkerSessionId,
  isWorkerSessionId,
  WORKER_SESSION_PREFIX,
  type FeaturePaneType,
} from './paneTypes';
import { en } from '../i18n/locales/en';

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

  describe('AI worker session ids', () => {
    it('mints ids with the h- prefix that are still plain sessions to the pane model', () => {
      const id = makeWorkerSessionId();
      expect(id.startsWith(WORKER_SESSION_PREFIX)).toBe(true);
      expect(isWorkerSessionId(id)).toBe(true);
      // A worker that is later materialized into a tab keeps its id, so the id
      // must never resolve to a feature pane type.
      expect(getPaneContentType(id)).toBe('session');
      expect(isFeaturePane(id)).toBe(false);
    });

    it('does not mistake ordinary session or pane ids for workers', () => {
      expect(isWorkerSessionId('s-m1abc-xyz')).toBe(false);
      expect(isWorkerSessionId('ai-abc')).toBe(false);
      expect(isWorkerSessionId('')).toBe(false);
    });
  });

  describe('FEATURE_LABEL_KEYS', () => {
    it('names a chrome.tabBar key for each type', () => {
      expect(FEATURE_LABEL_KEYS['log-viewer']).toBe('chrome.tabBar.logViewer');
      expect(FEATURE_LABEL_KEYS['ping-monitor']).toBe('chrome.tabBar.pingMonitor');
      expect(FEATURE_LABEL_KEYS['ai-chat']).toBe('chrome.tabBar.aiChat');
      expect(FEATURE_LABEL_KEYS['file-server']).toBe('chrome.tabBar.fileServer');
      expect(FEATURE_LABEL_KEYS['web-browser']).toBe('chrome.tabBar.webBrowser');
      expect(FEATURE_LABEL_KEYS['interface-traffic']).toBe('chrome.tabBar.interfaceTraffic');
    });

    it('every key resolves to a real English string, not the raw key', () => {
      // The label is looked up at render time now, so a typo here would surface
      // as the dotted key sitting in the tab rather than a compile error.
      const tabBar: Record<string, string> = en.chrome.tabBar;
      for (const key of Object.values(FEATURE_LABEL_KEYS)) {
        const [, region, leaf] = key.split('.');
        expect(region, `${key} is not a chrome.tabBar key`).toBe('tabBar');
        expect(tabBar[leaf], `missing English string for ${key}`).toBeTruthy();
      }
    });
  });
});

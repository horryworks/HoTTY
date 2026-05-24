import { describe, it, expect } from 'vitest';
import type { GceInstance, ProjectAccess } from '../../types/appTypes';
import {
  getEffectiveIapAccess,
  getEffectiveOsLoginAccess,
  isInstanceAccessible,
} from './gcpAccessHelpers';

const mkInst = (overrides: Partial<GceInstance> = {}): GceInstance => ({
  name: 'vm-x',
  status: 'RUNNING',
  zone: 'us-central1-a',
  ...overrides,
});

const PA_GRANTED: ProjectAccess = { iapTunnel: 'granted', osLogin: 'granted' };
const PA_DENIED: ProjectAccess = { iapTunnel: 'denied', osLogin: 'denied' };
const PA_UNKNOWN: ProjectAccess = { iapTunnel: 'unknown', osLogin: 'unknown' };

describe('getEffectiveIapAccess', () => {
  it('returns granted when project grants IAP', () => {
    expect(getEffectiveIapAccess(mkInst(), PA_GRANTED)).toBe('granted');
  });

  it('returns denied when project denies IAP and no resource-level override', () => {
    expect(getEffectiveIapAccess(mkInst(), PA_DENIED)).toBe('denied');
  });

  it('resource-level grant overrides project-level denial', () => {
    const inst = mkInst({ access: { iapTunnel: 'granted', osLogin: 'denied' } });
    expect(getEffectiveIapAccess(inst, PA_DENIED)).toBe('granted');
  });

  it('resource-level denial overrides project-level grant', () => {
    const inst = mkInst({ access: { iapTunnel: 'denied', osLogin: 'granted' } });
    expect(getEffectiveIapAccess(inst, PA_GRANTED)).toBe('denied');
  });

  it('falls back to unknown when neither level has data', () => {
    expect(getEffectiveIapAccess(mkInst(), undefined)).toBe('unknown');
  });

  it('falls back to unknown when probe explicitly failed', () => {
    expect(getEffectiveIapAccess(mkInst(), PA_UNKNOWN)).toBe('unknown');
  });
});

describe('getEffectiveOsLoginAccess', () => {
  it('reads from project when no resource-level data', () => {
    expect(getEffectiveOsLoginAccess(mkInst(), PA_GRANTED)).toBe('granted');
    expect(getEffectiveOsLoginAccess(mkInst(), PA_DENIED)).toBe('denied');
  });

  it('resource-level wins over project-level', () => {
    const inst = mkInst({ access: { iapTunnel: 'granted', osLogin: 'granted' } });
    expect(getEffectiveOsLoginAccess(inst, PA_DENIED)).toBe('granted');
  });

  it('defaults to unknown when nothing is known', () => {
    expect(getEffectiveOsLoginAccess(mkInst(), undefined)).toBe('unknown');
  });
});

describe('isInstanceAccessible', () => {
  it('hides instances explicitly denied at the project level', () => {
    expect(isInstanceAccessible(mkInst(), PA_DENIED)).toBe(false);
  });

  it('shows instances granted at the project level', () => {
    expect(isInstanceAccessible(mkInst(), PA_GRANTED)).toBe(true);
  });

  it('shows unknown instances (safe-side default — avoid false negatives)', () => {
    expect(isInstanceAccessible(mkInst(), PA_UNKNOWN)).toBe(true);
    expect(isInstanceAccessible(mkInst(), undefined)).toBe(true);
  });

  it('shows resource-level granted instance even when project is denied', () => {
    const inst = mkInst({ access: { iapTunnel: 'granted', osLogin: 'unknown' } });
    expect(isInstanceAccessible(inst, PA_DENIED)).toBe(true);
  });

  it('hides resource-level denied instance even when project is granted', () => {
    const inst = mkInst({ access: { iapTunnel: 'denied', osLogin: 'granted' } });
    expect(isInstanceAccessible(inst, PA_GRANTED)).toBe(false);
  });

  it('treats old snapshots (no access fields) as visible (backwards-compat)', () => {
    // Both project-level and resource-level missing — simulates a cache from
    // before the permission-filter feature shipped.
    expect(isInstanceAccessible(mkInst(), undefined)).toBe(true);
  });
});

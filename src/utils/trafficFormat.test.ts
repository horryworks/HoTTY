import { describe, it, expect } from 'vitest';
import {
  NO_VALUE,
  adminStatusKey,
  formatBps,
  formatCount,
  formatDelta,
  formatPps,
  formatSpeed,
  formatUptime,
  formatUtil,
  operStatusKey,
} from './trafficFormat';

describe('trafficFormat', () => {
  describe('formatBps', () => {
    it('scales through the SI units', () => {
      expect(formatBps(0)).toBe('0 bps');
      expect(formatBps(999)).toBe('999 bps');
      expect(formatBps(1000)).toBe('1.00 kbps');
      expect(formatBps(1_234_000)).toBe('1.23 Mbps');
      expect(formatBps(12_340_000)).toBe('12.3 Mbps');
      expect(formatBps(123_400_000)).toBe('123 Mbps');
      expect(formatBps(1_230_000_000)).toBe('1.23 Gbps');
    });

    it('renders missing values as an em-dash', () => {
      expect(formatBps(null)).toBe(NO_VALUE);
      expect(formatBps(undefined)).toBe(NO_VALUE);
    });

    it('rejects nonsense rather than printing it', () => {
      expect(formatBps(Number.NaN)).toBe(NO_VALUE);
      expect(formatBps(Number.POSITIVE_INFINITY)).toBe(NO_VALUE);
      expect(formatBps(-1)).toBe(NO_VALUE);
    });
  });

  describe('formatPps', () => {
    it('scales through the packet units', () => {
      expect(formatPps(120)).toBe('120 pps');
      expect(formatPps(12_300)).toBe('12.3 kpps');
      expect(formatPps(1_500_000)).toBe('1.50 Mpps');
    });

    it('renders missing values as an em-dash', () => {
      expect(formatPps(undefined)).toBe(NO_VALUE);
    });
  });

  describe('formatSpeed', () => {
    it('converts Mbit/s to the unit an engineer expects', () => {
      expect(formatSpeed(1000)).toBe('1.00 Gbps');
      expect(formatSpeed(100)).toBe('100 Mbps');
      expect(formatSpeed(10_000)).toBe('10.0 Gbps');
    });

    it('treats an unknown or zero speed as no value', () => {
      expect(formatSpeed(0)).toBe(NO_VALUE);
      expect(formatSpeed(undefined)).toBe(NO_VALUE);
    });
  });

  describe('formatUtil', () => {
    it('renders one decimal place', () => {
      expect(formatUtil(0)).toBe('0.0%');
      expect(formatUtil(42.66)).toBe('42.7%');
      expect(formatUtil(100)).toBe('100.0%');
    });

    it('renders missing values as an em-dash', () => {
      expect(formatUtil(null)).toBe(NO_VALUE);
    });
  });

  describe('formatCount', () => {
    it('groups thousands', () => {
      expect(formatCount(0)).toBe('0');
      expect(formatCount(1234567)).toBe('1,234,567');
    });

    it('renders missing values as an em-dash', () => {
      expect(formatCount(undefined)).toBe(NO_VALUE);
    });
  });

  describe('formatDelta', () => {
    // Zero and "unknown" are genuinely different answers here: 0 means the
    // counter did not move this poll, the em-dash means we could not measure.
    it('shows zero as 0, not as an em-dash', () => {
      expect(formatDelta(0)).toBe('0');
    });

    it('signs a non-zero increment', () => {
      expect(formatDelta(7)).toBe('+7');
      expect(formatDelta(12345)).toBe('+12,345');
    });

    it('renders an unmeasurable delta as an em-dash', () => {
      expect(formatDelta(undefined)).toBe(NO_VALUE);
      expect(formatDelta(null)).toBe(NO_VALUE);
    });
  });

  describe('operStatusKey', () => {
    it('maps every IF-MIB ifOperStatus value', () => {
      expect(operStatusKey(1)).toBe('up');
      expect(operStatusKey(2)).toBe('down');
      expect(operStatusKey(3)).toBe('testing');
      expect(operStatusKey(4)).toBe('unknown');
      expect(operStatusKey(5)).toBe('dormant');
      expect(operStatusKey(6)).toBe('notPresent');
      expect(operStatusKey(7)).toBe('lowerLayerDown');
    });

    it('falls back to unknown for out-of-range and missing values', () => {
      expect(operStatusKey(99)).toBe('unknown');
      expect(operStatusKey(undefined)).toBe('unknown');
    });
  });

  describe('adminStatusKey', () => {
    it('maps the three ifAdminStatus values', () => {
      expect(adminStatusKey(1)).toBe('up');
      expect(adminStatusKey(2)).toBe('down');
      expect(adminStatusKey(3)).toBe('testing');
      expect(adminStatusKey(4)).toBe('unknown');
    });
  });

  describe('formatUptime', () => {
    it('renders a clock below one day', () => {
      expect(formatUptime(0)).toBe('00:00:00');
      expect(formatUptime(3661)).toBe('01:01:01');
    });

    it('prefixes days once past 24 hours', () => {
      expect(formatUptime(86400 + 3661)).toBe('1d 01:01:01');
      expect(formatUptime(12 * 86400 + 11045)).toBe('12d 03:04:05');
    });

    it('renders missing values as an em-dash', () => {
      expect(formatUptime(undefined)).toBe(NO_VALUE);
      expect(formatUptime(-1)).toBe(NO_VALUE);
    });
  });
});

import { describe, it, expect } from 'vitest';
import { triToBool, boolToTri, resolveFixedSize } from './fixedTerminalSize';

describe('fixedTerminalSize tri-state helpers', () => {
  it('triToBool maps default to undefined (follow global) and on/off to booleans', () => {
    expect(triToBool('default')).toBeUndefined();
    expect(triToBool('on')).toBe(true);
    expect(triToBool('off')).toBe(false);
  });

  it('boolToTri maps undefined to default and booleans to on/off', () => {
    expect(boolToTri(undefined)).toBe('default');
    expect(boolToTri(true)).toBe('on');
    expect(boolToTri(false)).toBe('off');
  });

  it('round-trips every state', () => {
    for (const v of ['default', 'on', 'off'] as const) {
      expect(boolToTri(triToBool(v))).toBe(v);
    }
  });
});

describe('resolveFixedSize', () => {
  it('honours an explicit per-connection override over every global mode', () => {
    for (const mode of ['off', 'auto', 'on'] as const) {
      for (const detected of [true, false, undefined]) {
        expect(resolveFixedSize(true, mode, detected)).toBe(true);
        expect(resolveFixedSize(false, mode, detected)).toBe(false);
      }
    }
  });

  it("mode 'on' pins regardless of detection", () => {
    expect(resolveFixedSize(undefined, 'on', false)).toBe(true);
    expect(resolveFixedSize(undefined, 'on', undefined)).toBe(true);
  });

  it("mode 'off' never pins, even for a detected width-latching device", () => {
    expect(resolveFixedSize(undefined, 'off', true)).toBe(false);
  });

  it("mode 'auto' follows the device fingerprint", () => {
    expect(resolveFixedSize(undefined, 'auto', true)).toBe(true);
    expect(resolveFixedSize(undefined, 'auto', false)).toBe(false);
  });

  it("mode 'auto' stays dynamic before detection is known", () => {
    // Undefined = the connect-time pty-size event hasn't landed yet.
    expect(resolveFixedSize(undefined, 'auto', undefined)).toBe(false);
  });
});

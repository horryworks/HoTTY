/**
 * Tri-state for the per-connection "fixed terminal size" control: follow the
 * global default, or force it on/off for a specific connection/host. Lives in a
 * neutral util so both SessionDialog and the HostTree edit modal can use it
 * without a circular import (SessionDialog embeds HostTree).
 *
 * "Fixed terminal size" pins the terminal grid to the width the device latched at
 * connect (for devices that ignore later window-change, e.g. Huawei USG/VRP).
 */
export type FixedSizeTri = 'default' | 'on' | 'off';

/** Form tri-state → stored boolean (`undefined` = follow the global default). */
export function triToBool(v: FixedSizeTri): boolean | undefined {
  return v === 'default' ? undefined : v === 'on';
}

/** Stored boolean (or absent) → form tri-state. */
export function boolToTri(v: boolean | undefined): FixedSizeTri {
  return v === undefined ? 'default' : v ? 'on' : 'off';
}

/**
 * Global fixed-terminal-size policy.
 * - `off`  — never pin.
 * - `auto` — pin only for device families known to latch the pty width, detected
 *            from the SSH ident (see `device_latches_terminal_width` in ssh.rs).
 * - `on`   — always pin.
 */
export type FixedSizeMode = 'off' | 'auto' | 'on';

/**
 * Resolve whether a session's grid should be pinned to the connect-time width.
 * Precedence: explicit per-connection override > global on/off > auto-detection.
 *
 * `deviceLatchesWidth` is undefined until the connect-time `session-pty-size`
 * event arrives; under `auto` that means "not (yet) known to latch" → dynamic.
 * That is the safe default — pinning a device that resizes fine would letterbox
 * it for no reason, whereas the pin can only take effect once the pty width is
 * known anyway.
 */
export function resolveFixedSize(
  override: boolean | undefined,
  mode: FixedSizeMode,
  deviceLatchesWidth: boolean | undefined
): boolean {
  if (override !== undefined) return override;
  if (mode === 'on') return true;
  if (mode === 'off') return false;
  return deviceLatchesWidth ?? false;
}

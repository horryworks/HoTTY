// Number formatting for the Interface Traffic Watcher table.
//
// All pure — the pane renders a lot of cells per poll, so these stay allocation-
// light and free of locale lookups beyond the thousands separator.

/** The em-dash used across panes for "no value". */
export const NO_VALUE = '—';

const BPS_UNITS = ['bps', 'kbps', 'Mbps', 'Gbps', 'Tbps'] as const;
const PPS_UNITS = ['pps', 'kpps', 'Mpps', 'Gpps'] as const;

function scale(value: number, units: readonly string[]): string {
  if (!Number.isFinite(value) || value < 0) return NO_VALUE;
  let scaled = value;
  let unit = 0;
  while (scaled >= 1000 && unit < units.length - 1) {
    scaled /= 1000;
    unit += 1;
  }
  // Keep the column narrow but readable: 3 significant-ish digits below 100,
  // whole numbers above. 999.4 Mbps and 1.23 Gbps both fit.
  const digits = unit === 0 ? 0 : scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2;
  return `${scaled.toFixed(digits)} ${units[unit]}`;
}

/** Bits per second with an SI-scaled unit (`1.23 Gbps`). */
export function formatBps(value: number | null | undefined): string {
  if (value === null || value === undefined) return NO_VALUE;
  return scale(value, BPS_UNITS);
}

/** Packets per second with an SI-scaled unit (`12.3 kpps`). */
export function formatPps(value: number | null | undefined): string {
  if (value === null || value === undefined) return NO_VALUE;
  return scale(value, PPS_UNITS);
}

/** Link speed in Mbit/s, shown in the unit an engineer expects (`10 Gbps`). */
export function formatSpeed(speedMbps: number | null | undefined): string {
  if (speedMbps === null || speedMbps === undefined || speedMbps <= 0) return NO_VALUE;
  return scale(speedMbps * 1_000_000, BPS_UNITS);
}

/** Utilization percentage, one decimal (`42.7%`). */
export function formatUtil(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return NO_VALUE;
  return `${value.toFixed(1)}%`;
}

/** Cumulative counter with thousands separators. */
export function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return NO_VALUE;
  return value.toLocaleString('en-US');
}

/**
 * Per-poll increment. Zero is rendered as `0` rather than an em-dash: "no new
 * errors this poll" is a real, reassuring answer, whereas the em-dash means
 * "we could not measure".
 */
export function formatDelta(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return NO_VALUE;
  return value === 0 ? '0' : `+${value.toLocaleString('en-US')}`;
}

/** IF-MIB `ifOperStatus` / `ifAdminStatus` enum → i18n key suffix. */
export function operStatusKey(status: number | null | undefined): string {
  switch (status) {
    case 1:
      return 'up';
    case 2:
      return 'down';
    case 3:
      return 'testing';
    case 4:
      return 'unknown';
    case 5:
      return 'dormant';
    case 6:
      return 'notPresent';
    case 7:
      return 'lowerLayerDown';
    default:
      return 'unknown';
  }
}

/** `ifAdminStatus` has only the first three values. */
export function adminStatusKey(status: number | null | undefined): string {
  switch (status) {
    case 1:
      return 'up';
    case 2:
      return 'down';
    case 3:
      return 'testing';
    default:
      return 'unknown';
  }
}

/** Seconds of device uptime → `12d 03:04:05`. */
export function formatUptime(secs: number | null | undefined): string {
  if (secs === null || secs === undefined || !Number.isFinite(secs) || secs < 0) return NO_VALUE;
  const total = Math.floor(secs);
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const clock = [hours, minutes, seconds].map((n) => String(n).padStart(2, '0')).join(':');
  return days > 0 ? `${days}d ${clock}` : clock;
}

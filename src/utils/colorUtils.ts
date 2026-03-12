/**
 * Convert a 6-digit hex color to rgba with the given alpha value.
 * Returns the original string unchanged for non-hex values.
 */
export function hexToRgba(hex: string, alpha: number): string {
    if (hex.startsWith('#') && hex.length === 7) {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
    return hex;
}

/**
 * Convert a hex color to rgba with 0.85 alpha (used for terminal/pane backgrounds).
 */
export function getTransparentColor(hex: string): string {
    return hexToRgba(hex, 0.85);
}

/**
 * Where a drag lands relative to the row it is hovering, for the drag-to-reorder
 * trees (the Host Tree, and the bookmark trees that grew the same rule).
 *
 * Pure and dependency-free on purpose — the same shape as `hostTreeFilter.ts` —
 * so the bands are unit-testable without a DOM. The caller reads the geometry
 * off the event; this decides what it means.
 */

/** The three places a dragged node can go relative to the hovered row. */
export type DropPosition = 'before' | 'after' | 'inside';

export interface DropPositionInput {
    /** Pointer offset from the top of the row: `e.clientY - rect.top`. */
    offsetY: number;
    /** Row height: `rect.height`. */
    height: number;
    /** A folder can be dropped *into*; a leaf can only be ordered around. */
    isFolder: boolean;
    /**
     * Whether this folder's children are drawn directly beneath it **right now**.
     *
     * Read it off what is on screen, not off the stored collapse flag: the Host
     * Tree draws every folder open while a filter is active, and a band computed
     * from the stored flag would then point at a row several lines away.
     */
    showsChildren: boolean;
}

/**
 * Split a row into drop bands.
 *
 * - A leaf splits in half: `before` above the middle, `after` below.
 * - A folder whose children are hidden splits in quarters: `before` / `inside` /
 *   `after`.
 * - A folder already showing its children has **no `after` band** — its bottom
 *   edge does not touch its next sibling, so a line drawn there would be a lie.
 *   The top quarter is `before`; everything else drops inside.
 *
 * Note for tests: jsdom's `getBoundingClientRect()` returns zeroes, so a row
 * measured there has `height: 0` and the default `clientY: 0` — which lands on
 * `inside` for a folder and `after` for a leaf.
 */
export function computeDropPosition({
    offsetY,
    height,
    isFolder,
    showsChildren,
}: DropPositionInput): DropPosition {
    if (!isFolder) return offsetY < height * 0.5 ? 'before' : 'after';
    if (offsetY < height * 0.25) return 'before';
    if (showsChildren) return 'inside';
    return offsetY > height * 0.75 ? 'after' : 'inside';
}

import type { HostTreeNode } from '../types/appTypes';

/**
 * The glyph shown at the head of a Host Tree row.
 *
 * NetBox-mirrored Regions and Sites get their own glyphs so they are
 * distinguishable from folders the user made by hand at a glance, without
 * reading the name or noticing the accent edge on the row.
 *
 * The `NetBox` container itself deliberately stays a plain folder. ADR-018
 * gives its name and its position to the *user* — only the levels whose names
 * NetBox owns are marked, so the glyph means "NetBox decides what this is
 * called", not merely "this is somewhere near the integration".
 *
 * A `missing` folder keeps its glyph. The row already carries a warning edge
 * and a text marker; swapping the icon too would say the object changed type.
 */
export function nodeIcon(node: HostTreeNode): string {
    if (node.type === 'folder') {
        switch (node.netbox?.kind) {
            case 'region':
                return '\u{1F310}'; // globe with meridians
            case 'site':
                return '\u{1F3E2}'; // office building
            default:
                return '\u{1F4C1}'; // file folder
        }
    }
    return node.entry?.isJumpbox ? '\u{1F517}' : '\u{1F5A5}'; // link / desktop computer
}

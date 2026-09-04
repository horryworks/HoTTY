import { useCallback } from 'react';

export interface TabKeyboardNavOptions {
    /** Tab ids in display order. */
    ids: string[];
    /** The currently selected id, if any. */
    activeId: string | null | undefined;
    /** Select a tab. Called only when the selection actually changes. */
    onSelect: (id: string) => void;
    /**
     * Whether Left/Right wrap around at the ends. Default true — with a strip
     * that scrolls, stopping dead at the last tab reads as a broken key.
     */
    wrap?: boolean;
}

/**
 * Arrow-key navigation for a strip of tabs.
 *
 * Attach the returned handler to the scrolling tab container. Left/Right move
 * the *selection* to the adjacent tab; Home/End jump to the ends. Every handled
 * key calls `preventDefault`, which is the point: a horizontally scrollable
 * container natively answers the arrow keys by scrolling a few pixels, so
 * without this the arrows nudge the strip sideways instead of changing tab.
 *
 * Scrolling the newly selected tab into view is the caller's job — pass the
 * selected tab's ref to `ScrollStrip` as `activeChildRef` — because only the
 * caller knows which DOM node belongs to which id.
 */
export function useTabKeyboardNav({
    ids,
    activeId,
    onSelect,
    wrap = true,
}: TabKeyboardNavOptions): { onKeyDown: (e: React.KeyboardEvent) => void } {
    const onKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            if (ids.length === 0) return;
            // Let a modified arrow through: those are window/app shortcuts, and
            // hijacking them here would shadow them everywhere a tab strip has
            // focus.
            if (e.altKey || e.ctrlKey || e.metaKey) return;

            const current = activeId ? ids.indexOf(activeId) : -1;
            let next: number | null = null;

            switch (e.key) {
                case 'ArrowLeft':
                    next = current <= 0 ? (wrap ? ids.length - 1 : 0) : current - 1;
                    break;
                case 'ArrowRight':
                    next =
                        current === -1
                            ? 0
                            : current >= ids.length - 1
                              ? wrap
                                  ? 0
                                  : ids.length - 1
                              : current + 1;
                    break;
                case 'Home':
                    next = 0;
                    break;
                case 'End':
                    next = ids.length - 1;
                    break;
                default:
                    return;
            }

            // Always swallow the key, even when the selection does not move:
            // otherwise the container scrolls sideways at the ends, which is
            // exactly the behaviour being replaced.
            e.preventDefault();
            const id = ids[next];
            if (id && id !== activeId) onSelect(id);
        },
        [ids, activeId, onSelect, wrap],
    );

    return { onKeyDown };
}

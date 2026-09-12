import { useTranslation } from 'react-i18next';
import type { ResizeDir } from '../../hooks/useDialogGeometry';
import './DialogResizeFrame.css';

interface DialogResizeFrameProps {
    onResizeStart: (dir: ResizeDir, e: React.PointerEvent) => void;
    /** Double-click the bottom-right corner. Omit to leave that corner drag-only. */
    onResetSize?: () => void;
}

/**
 * The eight grab areas around a resizable dialog: four 6px edges and four
 * corners, all transparent.
 *
 * Nothing is drawn. A diagonal grip used to mark the bottom-right corner, from
 * when that corner was the only place a dialog could be resized from; once
 * every edge works, the mark says less than the cursor already does and is just
 * something sitting in the corner of every dialog.
 *
 * Rendered as a fragment, not a wrapper: the handles are `position: absolute`
 * children of the dialog itself, so they sit outside its flex flow and cost the
 * layout nothing.
 *
 * **Order matters.** The corners come after the edges so that, at equal
 * z-index, a later sibling wins the overlap and a press near a corner resizes
 * both axes rather than one.
 *
 * None of the eight is announced: they are pointer affordances, the same as a
 * window border, and eight invisible strips reading themselves out would be
 * noise. The bottom-right one keeps a tooltip, which is the only thing left
 * that mentions double-click-to-reset.
 */
export function DialogResizeFrame({ onResizeStart, onResetSize }: DialogResizeFrameProps) {
    const { t } = useTranslation();
    const hint = t('common.resizeHint');

    const edge = (dir: ResizeDir) => ({
        className: `drf-edge drf-${dir}`,
        onPointerDown: (e: React.PointerEvent) => onResizeStart(dir, e),
        'aria-hidden': true as const,
    });

    return (
        <>
            <div {...edge('n')} />
            <div {...edge('s')} />
            <div {...edge('w')} />
            <div {...edge('e')} />
            <div {...edge('nw')} />
            <div {...edge('ne')} />
            <div {...edge('sw')} />
            <div {...edge('se')} onDoubleClick={onResetSize} title={hint} />
        </>
    );
}

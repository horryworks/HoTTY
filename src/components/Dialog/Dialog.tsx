import { useCallback, useId, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useDialogGeometry, type DialogSize } from '../../hooks/useDialogGeometry';
import { useDialogStack } from '../../hooks/useDialogStack';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { useModalEscape } from '../../hooks/useModalEscape';
import { useOverlayDismiss } from '../../hooks/useDragSafeClick';
import { useSettingsStore } from '../../stores/settingsStore';
import type { DialogId } from '../../stores/settingsStore';
import { DialogResizeFrame } from '../DialogResizeFrame/DialogResizeFrame';
import './Dialog.css';

/** Fixed width, or a proportional one with bounds. */
export type DialogWidth = number | { width: number | string; minWidth?: number; maxWidth?: number };

export interface DialogGeometry {
    /** Where this dialog's size is remembered. */
    persistKey: DialogId;
    /** Size before the user has ever resized it. Mirror it in the stylesheet. */
    defaultSize: DialogSize;
    /** Floor for a resize drag. */
    minSize: DialogSize;
}

export interface DialogProps {
    open: boolean;
    /** Escape, the close button and (when enabled) a backdrop click all call this. */
    onClose: () => void;
    /** Header text. Also labels the dialog for assistive technology. */
    title: React.ReactNode;
    /** Extra header content beside the title, such as a scope or subtitle. */
    titleExtra?: React.ReactNode;
    /** Set false for a dialog whose only exits are its own footer buttons. */
    showClose?: boolean;
    /** `warning` paints the header and border in the caution palette. */
    tone?: 'default' | 'warning';
    /** Sizing for a fixed dialog. Ignored when `geometry` is given. */
    width?: DialogWidth;
    /** Opting in to move-and-resize. Omit for a fixed-size dialog. */
    geometry?: DialogGeometry;
    /**
     * Whether a click on the backdrop closes the dialog. Off by default:
     * anything holding a form loses work that way, so only reference sheets and
     * previews turn it on.
     */
    dismissOnOutsideClick?: boolean;
    /** A band between the header and the body — a tab strip, toolbar or alert. */
    subheader?: React.ReactNode;
    /** Action row. Omit and no footer is rendered at all. */
    footer?: React.ReactNode;
    /** For the rare body that needs different padding. */
    bodyClassName?: string;
    /** Extra class on the dialog box, for per-dialog layout. */
    className?: string;
    children?: React.ReactNode;
}

function widthStyle(width: DialogWidth | undefined): React.CSSProperties {
    if (width === undefined) return {};
    if (typeof width === 'number') return { width: `${width}px` };
    return {
        width: typeof width.width === 'number' ? `${width.width}px` : width.width,
        minWidth: width.minWidth,
        maxWidth: width.maxWidth,
    };
}

/**
 * The shell every dialog in the app shares: backdrop, box, header with a title
 * and close button, optional band, scrolling body, optional footer — plus focus
 * trapping, Escape, stacking order and, when asked for, Windows-style move and
 * resize.
 *
 * It exists because the alternative did not hold. The overlay declarations were
 * copied into sixteen stylesheets and the box into thirteen, and three separate
 * hand-maintained lists of overlay class names had each fallen behind reality —
 * one of them leaving the backdrop unblurred on five dialogs, another letting a
 * native webview paint over three. A dialog assembled from a component cannot
 * drift from the others; one assembled by copying a checklist always does.
 *
 * Callers supply content and policy. Everything structural lives here.
 */
export function Dialog({
    open,
    onClose,
    title,
    titleExtra,
    showClose = true,
    tone = 'default',
    width,
    geometry,
    dismissOnOutsideClick = false,
    subheader,
    footer,
    bodyClassName,
    className,
    children,
}: DialogProps) {
    const { t } = useTranslation();
    const titleId = useId();
    const surfaceRef = useRef<HTMLDivElement | null>(null);

    const { zIndex, isTop } = useDialogStack(open);
    useFocusTrap(surfaceRef, open);
    // The Escape stack picks the frontmost handler itself, so this passes the
    // callback unconditionally rather than gating on `isTop`: a modal that has
    // not moved to `<Dialog>` yet is in that stack but not in this one.
    useModalEscape(open ? onClose : null);

    const dismissProps = useOverlayDismiss<HTMLDivElement>(
        open && dismissOnOutsideClick && isTop ? onClose : null
    );

    const storedSize = useSettingsStore((s) =>
        geometry ? s.dialogSizes[geometry.persistKey] : undefined
    );
    const updateSetting = useSettingsStore((s) => s.update);

    const persistKey = geometry?.persistKey;
    const writeSize = useCallback(
        (size: DialogSize | null) => {
            if (!persistKey) return;
            // Read-modify-write off the live store rather than subscribing to the
            // whole record: this runs once per drag, and a subscription here
            // would re-render every open dialog whenever any of them resized.
            const current = useSettingsStore.getState().dialogSizes;
            const next = { ...current };
            if (size) next[persistKey] = size;
            else delete next[persistKey];
            updateSetting('dialogSizes', next);
        },
        [persistKey, updateSetting]
    );

    const onSizeCommit = useCallback((size: DialogSize) => writeSize(size), [writeSize]);
    // Dropping the key rather than storing the default keeps "never resized"
    // distinguishable, so a future change to the default still reaches the user.
    const onSizeReset = useCallback(() => writeSize(null), [writeSize]);

    const { moveHandleProps, startResize, resetGeometry } = useDialogGeometry({
        // Hooks cannot be called conditionally, so a fixed-size dialog runs this
        // one closed. Its handlers are never attached below either way.
        open: open && geometry !== undefined,
        dialogRef: surfaceRef,
        defaultSize: geometry?.defaultSize ?? { width: 0, height: 0 },
        minSize: geometry?.minSize ?? { width: 0, height: 0 },
        storedSize,
        onSizeCommit,
        onSizeReset,
    });

    if (!open) return null;

    const movable = geometry !== undefined;

    return (
        <div
            className={`dlg-overlay${movable ? ' dlg-overlay-backdrop-only' : ''}`}
            style={{ zIndex }}
            {...dismissProps}
        >
            <div
                className={`dlg-surface${tone === 'warning' ? ' dlg-warning' : ''}${className ? ` ${className}` : ''}`}
                ref={surfaceRef}
                style={movable ? undefined : widthStyle(width)}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
            >
                <div className="dlg-header" {...(movable ? moveHandleProps : {})}>
                    <span className="dlg-title" id={titleId}>
                        {title}
                    </span>
                    {titleExtra}
                    {showClose && (
                        <button
                            type="button"
                            className="dlg-close"
                            onClick={onClose}
                            aria-label={t('common.close')}
                            title={t('common.close')}
                        >
                            {'✕'}
                        </button>
                    )}
                </div>
                {subheader}
                <div className={`dlg-body${bodyClassName ? ` ${bodyClassName}` : ''}`}>{children}</div>
                {footer !== undefined && <div className="dlg-footer">{footer}</div>}
                {movable && (
                    <DialogResizeFrame onResizeStart={startResize} onResetSize={resetGeometry} />
                )}
            </div>
        </div>
    );
}

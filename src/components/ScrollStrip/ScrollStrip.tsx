import React, { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useStripScroll } from '../../hooks/useStripScroll';
import './ScrollStrip.css';

/** Hold this long before a held button starts repeating. */
const HOLD_MS = 400;
/** Interval between repeats while held. */
const REPEAT_MS = 120;

interface StepButtonProps {
    dir: 1 | -1;
    disabled: boolean;
    onStep: () => void;
    label: string;
}

/**
 * One end arrow. A click moves exactly one item; holding it repeats, so a long
 * strip does not need a dozen clicks.
 */
function StepButton({ dir, disabled, onStep, label }: StepButtonProps) {
    const holdTimer = useRef<number | null>(null);
    const repeatTimer = useRef<number | null>(null);

    const stop = useCallback(() => {
        if (holdTimer.current !== null) {
            window.clearTimeout(holdTimer.current);
            holdTimer.current = null;
        }
        if (repeatTimer.current !== null) {
            window.clearInterval(repeatTimer.current);
            repeatTimer.current = null;
        }
    }, []);

    // Stop on unmount, and when the button goes disabled — reaching the end
    // mid-hold must not leave an interval running against a dead button.
    useEffect(() => {
        if (disabled) stop();
    }, [disabled, stop]);
    useEffect(() => stop, [stop]);

    const start = useCallback(() => {
        onStep();
        stop();
        holdTimer.current = window.setTimeout(() => {
            repeatTimer.current = window.setInterval(onStep, REPEAT_MS);
        }, HOLD_MS);
    }, [onStep, stop]);

    return (
        <button
            type="button"
            className={`scroll-strip-btn ${dir < 0 ? 'left' : 'right'}`}
            aria-label={label}
            title={label}
            disabled={disabled}
            // Not onClick: the press has to start the hold-to-repeat timer, and
            // the release has to end it.
            onPointerDown={start}
            onPointerUp={stop}
            onPointerLeave={stop}
            onPointerCancel={stop}
        >
            {dir < 0 ? '‹' : '›'}
        </button>
    );
}

/**
 * Generic in the active child's element type so callers can pass the ref they
 * already have (`RefObject<HTMLButtonElement>`, `RefObject<HTMLDivElement>`)
 * without a cast — `RefObject` is invariant, so a plain `HTMLElement` ref would
 * not accept them.
 */
interface ScrollStripProps<T extends HTMLElement = HTMLElement> {
    /** Class for the scrolling element — the caller's existing tab-row class. */
    className: string;
    /** Extra class for the outer wrapper, when the caller needs to place it. */
    wrapClassName?: string;
    role?: string;
    ariaLabel?: string;
    tabIndex?: number;
    onKeyDown?: (e: React.KeyboardEvent) => void;
    /** The child that must stay visible — normally the selected tab. */
    activeChildRef?: React.RefObject<T | null>;
    /** Re-reveals `activeChildRef` whenever this value changes. */
    revealKey?: string | null;
    children: React.ReactNode;
}

/**
 * A horizontally scrolling row with an arrow button at each end.
 *
 * Shared by every tab strip in the app (terminal tabs, AI Chat tabs, settings
 * tabs) so all three scroll identically. The arrows appear only when the row
 * actually overflows, so a short row looks exactly as it did before.
 *
 * Why arrows rather than drag-to-scroll: the terminal tab bar already uses a
 * drag to reorder tabs, and one gesture cannot mean both. Arrows work the same
 * everywhere and leave no doubt about what a press will do.
 */
export function ScrollStrip<T extends HTMLElement = HTMLElement>({
    className,
    wrapClassName,
    role,
    ariaLabel,
    tabIndex,
    onKeyDown,
    activeChildRef,
    revealKey,
    children,
}: ScrollStripProps<T>) {
    const { t } = useTranslation();
    // Destructured, not held as an object: the object carries a ref, and
    // `react-hooks/refs` reads every member access on it as a ref read.
    const { ref, handlers, atStart, atEnd, fits, scrollByStep, revealChild } = useStripScroll();

    useEffect(() => {
        revealChild(activeChildRef?.current ?? null);
    }, [revealKey, revealChild, activeChildRef]);

    const stepLeft = useCallback(() => scrollByStep(-1), [scrollByStep]);
    const stepRight = useCallback(() => scrollByStep(1), [scrollByStep]);

    return (
        <div className={wrapClassName ? `scroll-strip-wrap ${wrapClassName}` : 'scroll-strip-wrap'}>
            {!fits && (
                <StepButton
                    dir={-1}
                    disabled={atStart}
                    onStep={stepLeft}
                    label={t('common.scrollStripLeft')}
                />
            )}
            <div
                ref={ref}
                role={role}
                aria-label={ariaLabel}
                tabIndex={tabIndex}
                onKeyDown={onKeyDown}
                className={[
                    className,
                    'scroll-strip',
                    fits ? '' : 'scrollable',
                    atStart ? 'at-start' : '',
                    atEnd ? 'at-end' : '',
                ]
                    .filter(Boolean)
                    .join(' ')}
                {...handlers}
            >
                {children}
            </div>
            {!fits && (
                <StepButton
                    dir={1}
                    disabled={atEnd}
                    onStep={stepRight}
                    label={t('common.scrollStripRight')}
                />
            )}
        </div>
    );
}

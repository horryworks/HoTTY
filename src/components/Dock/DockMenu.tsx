import { useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react';
import { useMenuDismiss } from '../../hooks/useMenuDismiss';
import './DockMenu.css';

/** Which side of its button a dock menu opens on. */
export type DockMenuPlacement = 'down' | 'up' | 'right' | 'left';

interface DockMenuProps {
  open: boolean;
  onClose: () => void;
  /** The button that opened the menu: it is positioned against, and counts as inside. */
  anchorRef: RefObject<HTMLElement | null>;
  placement: DockMenuPlacement;
  className?: string;
  /** `menu` for a list of commands; `group` for a row of toggle buttons. */
  role?: 'menu' | 'group';
  'aria-label'?: string;
  children: ReactNode;
}

const GAP = 4;
const MARGIN = 4;

/**
 * A popover that belongs to a button in the dock. It is `position: fixed` so
 * the dock's own overflow never clips it, and it carries the `dock-menu`
 * class, which is listed in `OVERLAY_SELECTOR`: while it is open a Web Browser
 * pane's native page is hidden instead of painting over it.
 *
 * The position is written straight to the DOM after layout, because it
 * depends on the menu's own measured size.
 */
export function DockMenu({
  open,
  onClose,
  anchorRef,
  placement,
  className,
  role = 'menu',
  'aria-label': ariaLabel,
  children,
}: DockMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  useMenuDismiss(open, [menuRef, anchorRef], onClose);

  useLayoutEffect(() => {
    const menu = menuRef.current;
    const anchor = anchorRef.current;
    if (!open || !menu || !anchor) return;
    const a = anchor.getBoundingClientRect();
    const w = menu.offsetWidth;
    const h = menu.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let side = placement;
    // Flip when the preferred side has no room and the other one does.
    if (side === 'down' && a.bottom + GAP + h > vh && a.top - GAP - h >= 0) side = 'up';
    else if (side === 'up' && a.top - GAP - h < 0 && a.bottom + GAP + h <= vh) side = 'down';
    else if (side === 'right' && a.right + GAP + w > vw && a.left - GAP - w >= 0) side = 'left';
    else if (side === 'left' && a.left - GAP - w < 0 && a.right + GAP + w <= vw) side = 'right';
    let left: number;
    let top: number;
    if (side === 'down' || side === 'up') {
      left = a.left;
      top = side === 'down' ? a.bottom + GAP : a.top - GAP - h;
    } else {
      top = a.top;
      left = side === 'right' ? a.right + GAP : a.left - GAP - w;
    }
    left = Math.max(MARGIN, Math.min(left, vw - w - MARGIN));
    top = Math.max(MARGIN, Math.min(top, vh - h - MARGIN));
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
  });

  if (!open) return null;
  return (
    <div
      ref={menuRef}
      className={`dock-menu${className ? ` ${className}` : ''}`}
      role={role}
      aria-label={ariaLabel}
    >
      {children}
    </div>
  );
}

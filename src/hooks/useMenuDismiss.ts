import { useEffect, useRef, type RefObject } from 'react';

/**
 * Close a menu or popover when the user presses outside it or hits Escape.
 *
 * `insideRefs` lists every element that counts as "inside": the menu itself
 * and, usually, the button that opened it. Leaving the button out makes a
 * second click on it close the menu on mousedown and reopen it on click.
 */
export function useMenuDismiss(
  open: boolean,
  insideRefs: ReadonlyArray<RefObject<HTMLElement | null>>,
  onClose: () => void
): void {
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  const refsRef = useRef(insideRefs);
  useEffect(() => {
    refsRef.current = insideRefs;
  });

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (refsRef.current.some((r) => r.current?.contains(target))) return;
      onCloseRef.current();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);
}

import { useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import './TerminalContextMenu.css';

interface TerminalContextMenuProps {
  /** Viewport X of the originating right-click (clientX). */
  x: number;
  /** Viewport Y of the originating right-click (clientY). */
  y: number;
  /** Fired with the typed question when the user submits (Enter). */
  onSubmit: (question: string) => void;
  onClose: () => void;
}

/**
 * Inline "Ask AI" input for the terminal right-click. Replaces the old fixed
 * preset menu: the user types their own question about the current selection
 * right here and presses Enter to send it to the AI chat pane. Mirrors the
 * positioning/dismissal of the HTML/React menus in HostTree/TabBar (the native
 * `show_context_menu` Tauri command does not return the picked item, so a
 * frontend popover is the only working path). Positioned at the click point
 * with `position: fixed`, clamped into the viewport, and dismissed on any
 * outside interaction or Esc.
 */
export function TerminalContextMenu({ x, y, onSubmit, onClose }: TerminalContextMenuProps) {
  const { t } = useTranslation();
  const menuRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [question, setQuestion] = useState('');

  // Focus the input as soon as the popover mounts so the user can type at once.
  useLayoutEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // Clamp into the viewport once the menu has a measured size. Written straight
  // to the DOM (not React state) to avoid a cascading re-render; (x, y) are
  // fixed for the menu's lifetime so React never overwrites these styles.
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    let nx = x;
    let ny = y;
    if (rect.width > 0 && x + rect.width > window.innerWidth) {
      nx = Math.max(0, window.innerWidth - rect.width - 4);
    }
    if (rect.height > 0 && y + rect.height > window.innerHeight) {
      ny = Math.max(0, window.innerHeight - rect.height - 4);
    }
    el.style.left = `${nx}px`;
    el.style.top = `${ny}px`;
  }, [x, y]);

  // Dismiss on any outside interaction or Esc. Pointer events use the capture
  // phase so the menu closes before the click reaches anything underneath; a
  // click that lands inside the menu is ignored so typing still works.
  useLayoutEffect(() => {
    const onPointerDown = (e: MouseEvent) => {
      if (menuRef.current && menuRef.current.contains(e.target as Node)) return;
      onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onPointerDown, true);
    document.addEventListener('contextmenu', onPointerDown, true);
    window.addEventListener('blur', onClose);
    window.addEventListener('resize', onClose);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown, true);
      document.removeEventListener('contextmenu', onPointerDown, true);
      window.removeEventListener('blur', onClose);
      window.removeEventListener('resize', onClose);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  const submit = () => {
    const text = question.trim();
    if (!text) return;
    onSubmit(text);
    onClose();
  };

  // Enter submits; Shift+Enter inserts a newline for multi-line questions.
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div
      ref={menuRef}
      className="terminal-context-menu"
      role="dialog"
      aria-label={t('terminal.askAiInputTitle')}
      style={{ left: x, top: y }}
    >
      <div className="terminal-context-menu-title">{t('terminal.askAiInputTitle')}</div>
      <textarea
        ref={textareaRef}
        className="terminal-context-menu-input"
        placeholder={t('terminal.askAiInputPlaceholder')}
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        onKeyDown={handleKeyDown}
        rows={2}
      />
    </div>
  );
}

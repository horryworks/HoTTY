import { describe, it, expect, vi } from 'vitest';
import { useRef } from 'react';
import { render, fireEvent } from '@testing-library/react';
import { useMenuDismiss } from './useMenuDismiss';

/** A menu and the button that opened it, both counted as "inside" by default. */
function Menu({
  open,
  onClose,
  includeButton = true,
}: {
  open: boolean;
  onClose: () => void;
  includeButton?: boolean;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useMenuDismiss(open, includeButton ? [buttonRef, menuRef] : [menuRef], onClose);
  return (
    <div>
      <button ref={buttonRef}>Open</button>
      {open && (
        <div ref={menuRef} data-testid="menu">
          <span data-testid="item">Item</span>
        </div>
      )}
      <p data-testid="outside">Elsewhere</p>
    </div>
  );
}

describe('useMenuDismiss', () => {
  it('closes on a press outside the menu', () => {
    const onClose = vi.fn();
    const { getByTestId } = render(<Menu open onClose={onClose} />);
    fireEvent.mouseDown(getByTestId('outside'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('stays open on a press inside the menu', () => {
    const onClose = vi.fn();
    const { getByTestId } = render(<Menu open onClose={onClose} />);
    fireEvent.mouseDown(getByTestId('item'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('stays open on a press on the opening button when it is listed as inside', () => {
    const onClose = vi.fn();
    const { getByText } = render(<Menu open onClose={onClose} />);
    fireEvent.mouseDown(getByText('Open'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes on a press on the opening button when it is left out', () => {
    const onClose = vi.fn();
    const { getByText } = render(<Menu open onClose={onClose} includeButton={false} />);
    fireEvent.mouseDown(getByText('Open'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape but not on other keys', () => {
    const onClose = vi.fn();
    render(<Menu open onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Enter' });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does nothing while closed', () => {
    const onClose = vi.fn();
    const { getByTestId } = render(<Menu open={false} onClose={onClose} />);
    fireEvent.mouseDown(getByTestId('outside'));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('stops listening once the menu closes or unmounts', () => {
    const onClose = vi.fn();
    const { getByTestId, rerender, unmount } = render(<Menu open onClose={onClose} />);
    rerender(<Menu open={false} onClose={onClose} />);
    fireEvent.mouseDown(getByTestId('outside'));
    expect(onClose).not.toHaveBeenCalled();

    rerender(<Menu open onClose={onClose} />);
    unmount();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('calls the latest onClose passed in', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { getByTestId, rerender } = render(<Menu open onClose={first} />);
    rerender(<Menu open onClose={second} />);
    fireEvent.mouseDown(getByTestId('outside'));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});

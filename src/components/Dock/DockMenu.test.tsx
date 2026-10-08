import { describe, it, expect, vi } from 'vitest';
import { useRef, useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { DockMenu } from './DockMenu';

function Harness({ onClose = () => {} }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={anchorRef} onClick={() => setOpen((v) => !v)}>
        anchor
      </button>
      <button>elsewhere</button>
      <DockMenu
        open={open}
        onClose={() => {
          onClose();
          setOpen(false);
        }}
        anchorRef={anchorRef}
        placement="down"
      >
        <button className="dock-menu-item">item</button>
      </DockMenu>
    </>
  );
}

describe('DockMenu', () => {
  it('renders only while open, with the class the webview watcher looks for', () => {
    render(<Harness />);
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.click(screen.getByText('anchor'));
    expect(screen.getByRole('menu').classList.contains('dock-menu')).toBe(true);
  });

  it('closes on a press outside, but not on its own anchor or contents', () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    fireEvent.click(screen.getByText('anchor'));
    fireEvent.mouseDown(screen.getByText('item'));
    fireEvent.mouseDown(screen.getByText('anchor'));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.mouseDown(screen.getByText('elsewhere'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes on Escape', () => {
    render(<Harness />);
    fireEvent.click(screen.getByText('anchor'));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('a second click on the anchor closes it', () => {
    render(<Harness />);
    fireEvent.click(screen.getByText('anchor'));
    fireEvent.click(screen.getByText('anchor'));
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

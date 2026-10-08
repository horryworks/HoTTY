import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PaneHeader } from './PaneHeader';

describe('PaneHeader', () => {
  it('shows the pane mark and the title, and the close button sits at the far right', () => {
    const onClose = vi.fn();
    const { container } = render(
      <PaneHeader paneId="0" title="AI Chat" actions={<button className="extra">x</button>} onClose={onClose} />
    );
    expect(container.querySelector('.pane-badge')?.textContent).toBe('1');
    expect(screen.getByText('AI Chat')).toBeTruthy();
    const buttons = Array.from(container.querySelectorAll('button')).map((b) => b.className);
    expect(buttons).toEqual(['extra', 'pane-term-close']);
    fireEvent.click(container.querySelector('.pane-term-close')!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

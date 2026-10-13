import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { useWatchPicker } from './useWatchPicker';
import type { ConversationSummary } from './tabBarHelpers';

const ONE: ConversationSummary[] = [{ id: 'c1', title: 'Tab 1', colorIndex: 0 }];
const TWO: ConversationSummary[] = [...ONE, { id: 'c2', title: 'Tab 2', colorIndex: 1 }];

interface HarnessProps {
  conversations: ConversationSummary[];
  onToggleWatch?: (id: string) => void;
  onWatchInConversation?: (sessionId: string, target: string | 'new') => void;
  ownerTabId?: string;
}

/** An AI link button wired the way TabBar and the pane header wire it. */
function Harness({ conversations, onToggleWatch, onWatchInConversation, ownerTabId }: HarnessProps) {
  const { onWatchClick, menuElement } = useWatchPicker({ conversations, onToggleWatch, onWatchInConversation });
  return (
    <>
      {onWatchClick ? (
        <button type="button" onClick={(e) => onWatchClick(e, 's1', ownerTabId)}>
          link
        </button>
      ) : (
        <span>no link</span>
      )}
      {menuElement}
    </>
  );
}

const press = () => fireEvent.click(screen.getByRole('button', { name: 'link' }));

describe('useWatchPicker', () => {
  it('offers no AI link when watching is unavailable', () => {
    render(<Harness conversations={TWO} onWatchInConversation={vi.fn()} />);
    expect(screen.getByText('no link')).toBeTruthy();
  });

  it('toggles the link directly when there is no conversation yet', () => {
    const onToggleWatch = vi.fn();
    render(<Harness conversations={[]} onToggleWatch={onToggleWatch} onWatchInConversation={vi.fn()} />);
    press();
    expect(onToggleWatch).toHaveBeenCalledWith('s1');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('toggles the link directly with a single conversation', () => {
    const onToggleWatch = vi.fn();
    render(<Harness conversations={ONE} onToggleWatch={onToggleWatch} onWatchInConversation={vi.fn()} />);
    press();
    expect(onToggleWatch).toHaveBeenCalledWith('s1');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('asks which conversation should watch when there are two or more', () => {
    const onToggleWatch = vi.fn();
    render(<Harness conversations={TWO} onToggleWatch={onToggleWatch} onWatchInConversation={vi.fn()} />);
    press();
    expect(onToggleWatch).not.toHaveBeenCalled();
    const menu = screen.getByRole('menu');
    expect(within(menu).getByText('Watch in')).toBeTruthy();
    expect(within(menu).getAllByRole('menuitemradio').map((el) => el.textContent)).toEqual(['Tab 1', 'Tab 2']);
    expect(within(menu).getByRole('menuitem', { name: /New conversation/ })).toBeTruthy();
  });

  it('falls back to toggling with several conversations when no picker handler is given', () => {
    const onToggleWatch = vi.fn();
    render(<Harness conversations={TWO} onToggleWatch={onToggleWatch} />);
    press();
    expect(onToggleWatch).toHaveBeenCalledWith('s1');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('opens the picker just below the button', () => {
    render(<Harness conversations={TWO} onToggleWatch={vi.fn()} onWatchInConversation={vi.fn()} />);
    const btn = screen.getByRole('button', { name: 'link' });
    btn.getBoundingClientRect = () => ({ left: 30, top: 50, bottom: 70, right: 60 }) as DOMRect;
    press();
    const menu = screen.getByRole('menu');
    expect(menu.style.left).toBe('30px');
    expect(menu.style.top).toBe('72px');
  });

  it('marks the conversation that already watches the terminal', () => {
    render(
      <Harness conversations={TWO} onToggleWatch={vi.fn()} onWatchInConversation={vi.fn()} ownerTabId="c2" />
    );
    press();
    const [first, second] = screen.getAllByRole('menuitemradio');
    expect(first.getAttribute('aria-checked')).toBe('false');
    expect(second.getAttribute('aria-checked')).toBe('true');
  });

  it('hands the picked conversation to the caller and closes the picker', () => {
    const onWatchInConversation = vi.fn();
    render(<Harness conversations={TWO} onToggleWatch={vi.fn()} onWatchInConversation={onWatchInConversation} />);
    press();
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Tab 2' }));
    expect(onWatchInConversation).toHaveBeenCalledWith('s1', 'c2');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('can start a new conversation from the picker', () => {
    const onWatchInConversation = vi.fn();
    render(<Harness conversations={TWO} onToggleWatch={vi.fn()} onWatchInConversation={onWatchInConversation} />);
    press();
    fireEvent.click(screen.getByRole('menuitem', { name: /New conversation/ }));
    expect(onWatchInConversation).toHaveBeenCalledWith('s1', 'new');
  });

  it('closes the picker on Escape without picking anything', () => {
    const onWatchInConversation = vi.fn();
    render(<Harness conversations={TWO} onToggleWatch={vi.fn()} onWatchInConversation={onWatchInConversation} />);
    press();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(onWatchInConversation).not.toHaveBeenCalled();
  });

  // A real press is mousedown → mouseup → click. The mousedown used to count as
  // "outside" and close the picker, and the click then opened it again at once.
  it('closes the picker when its own button is pressed again', () => {
    render(<Harness conversations={TWO} onToggleWatch={vi.fn()} onWatchInConversation={vi.fn()} />);
    const button = screen.getByRole('button', { name: 'link' });
    fireEvent.mouseDown(button);
    fireEvent.click(button);
    expect(screen.getByRole('menu')).toBeTruthy();
    fireEvent.mouseDown(button);
    fireEvent.mouseUp(button);
    fireEvent.click(button);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('still closes the picker on a press anywhere else', () => {
    render(<Harness conversations={TWO} onToggleWatch={vi.fn()} onWatchInConversation={vi.fn()} />);
    press();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

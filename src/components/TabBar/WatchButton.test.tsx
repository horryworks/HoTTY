import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WatchButton } from './WatchButton';

describe('WatchButton', () => {
  it('offers to start watching when not linked', () => {
    render(<WatchButton isWatching={false} onClick={() => {}} />);
    const btn = screen.getByRole('button', { name: 'Start AI Watch' });
    expect(btn.getAttribute('title')).toBe('AI Watch');
    expect(btn.classList.contains('watching')).toBe(false);
    expect(btn.style.getPropertyValue('--tab-watch-color')).toBe('');
  });

  it('shows the link as active when watched', () => {
    render(<WatchButton isWatching colorIndex={2} onClick={() => {}} />);
    const btn = screen.getByRole('button', { name: 'Stop AI Watch' });
    expect(btn.getAttribute('title')).toBe('AI Watch (Active)');
    expect(Array.from(btn.classList)).toEqual(expect.arrayContaining(['tab-watch-btn', 'watching']));
  });

  it("paints itself in the watching conversation's color", () => {
    render(<WatchButton isWatching colorIndex={2} onClick={() => {}} />);
    expect(screen.getByRole('button').style.getPropertyValue('--tab-watch-color')).toBe('var(--pane-color-3)');
  });

  it('uses the first palette slot for color index 0', () => {
    render(<WatchButton isWatching colorIndex={0} onClick={() => {}} />);
    expect(screen.getByRole('button').style.getPropertyValue('--tab-watch-color')).toBe('var(--pane-color-1)');
  });

  it('falls back to the default color when watched without a color index', () => {
    render(<WatchButton isWatching onClick={() => {}} />);
    expect(screen.getByRole('button').style.getPropertyValue('--tab-watch-color')).toBe('');
  });

  it('ignores the color index when not watched', () => {
    render(<WatchButton isWatching={false} colorIndex={3} onClick={() => {}} />);
    expect(screen.getByRole('button').style.getPropertyValue('--tab-watch-color')).toBe('');
  });

  it('fires onClick without the press reaching the tab underneath', () => {
    const onClick = vi.fn();
    const onParentClick = vi.fn();
    render(
      <div onClick={onParentClick}>
        <WatchButton isWatching={false} onClick={onClick} />
      </div>
    );
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onParentClick).not.toHaveBeenCalled();
  });

  it('shows an "AI" mark that screen readers skip', () => {
    render(<WatchButton isWatching={false} onClick={() => {}} />);
    const mark = screen.getByRole('button').querySelector('.tab-watch-mark');
    expect(mark?.textContent?.trim()).toBe('AI');
    expect(mark?.getAttribute('aria-hidden')).toBe('true');
  });

  it('is a plain button, so it never submits a surrounding form', () => {
    render(<WatchButton isWatching={false} onClick={() => {}} />);
    expect(screen.getByRole('button').getAttribute('type')).toBe('button');
  });
});

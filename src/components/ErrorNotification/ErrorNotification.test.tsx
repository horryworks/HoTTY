import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ErrorNotification } from './ErrorNotification';
import { useErrorNotificationStore } from '../../stores/errorNotificationStore';

describe('ErrorNotification', () => {
  beforeEach(() => {
    useErrorNotificationStore.getState().clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders nothing when there are no notifications', () => {
    const { container } = render(<ErrorNotification />);
    expect(container.firstChild).toBeNull();
  });

  it('shows the message but not the internal log category', () => {
    useErrorNotificationStore.getState().push('AIWindow', 'connection refused');
    render(<ErrorNotification />);
    expect(screen.getByText('connection refused')).toBeTruthy();
    expect(screen.queryByText('AIWindow')).toBeNull();
  });

  it('renders multiple notifications in order', () => {
    const store = useErrorNotificationStore.getState();
    store.push('A', 'first');
    store.push('B', 'second');
    store.push('C', 'third');
    render(<ErrorNotification />);
    const messages = screen.getAllByRole('alert').map((el) => el.textContent);
    expect(messages.length).toBe(3);
    expect(messages[0]).toContain('first');
    expect(messages[1]).toContain('second');
    expect(messages[2]).toContain('third');
  });

  it('dismisses a notification when its close button is clicked', () => {
    useErrorNotificationStore.getState().push('A', 'msg');
    render(<ErrorNotification />);
    const btn = screen.getByLabelText('Dismiss error notification');
    fireEvent.click(btn);
    expect(useErrorNotificationStore.getState().notifications).toHaveLength(0);
  });

  it('auto-dismisses after the timeout elapses', () => {
    useErrorNotificationStore.getState().push('A', 'msg');
    render(<ErrorNotification />);
    expect(useErrorNotificationStore.getState().notifications).toHaveLength(1);
    act(() => {
      vi.advanceTimersByTime(8000);
    });
    expect(useErrorNotificationStore.getState().notifications).toHaveLength(0);
  });

  it('does not auto-dismiss before the timeout', () => {
    useErrorNotificationStore.getState().push('A', 'msg');
    render(<ErrorNotification />);
    act(() => {
      vi.advanceTimersByTime(7999);
    });
    expect(useErrorNotificationStore.getState().notifications).toHaveLength(1);
  });
});

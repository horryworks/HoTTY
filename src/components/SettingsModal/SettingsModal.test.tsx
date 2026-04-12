import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SettingsModal } from './SettingsModal';
import { useSettingsStore } from '../../stores/settingsStore';

describe('SettingsModal', () => {
  beforeEach(() => {
    useSettingsStore.getState().reset();
  });

  it('renders nothing when open=false', () => {
    const { container } = render(<SettingsModal open={false} onClose={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows the Appearance tab by default', () => {
    render(<SettingsModal open onClose={() => {}} />);
    expect(screen.getByText('Font family')).toBeTruthy();
  });

  it('switches to the Terminal tab and edits scrollback', () => {
    render(<SettingsModal open onClose={() => {}} />);
    fireEvent.click(screen.getByText('Terminal'));
    const scrollbackInput = screen
      .getByText('Scrollback (lines)')
      .parentElement!.querySelector('input') as HTMLInputElement;
    fireEvent.change(scrollbackInput, { target: { value: '5000' } });
    expect(useSettingsStore.getState().scrollback).toBe(5000);
  });

  it('switches to the Connection tab and toggles keepalive', () => {
    render(<SettingsModal open onClose={() => {}} />);
    fireEvent.click(screen.getByText('Connection'));
    const checkbox = screen
      .getByText(/SSH keep-alive enabled/)
      .parentElement!.querySelector('input[type="checkbox"]') as HTMLInputElement;
    const before = useSettingsStore.getState().sshKeepAliveEnabled;
    fireEvent.click(checkbox);
    expect(useSettingsStore.getState().sshKeepAliveEnabled).toBe(!before);
  });

  it('clicking the overlay triggers onClose; clicking the modal body does not', () => {
    const onClose = vi.fn();
    const { container } = render(<SettingsModal open onClose={onClose} />);
    const overlay = container.querySelector('.settings-modal-overlay') as HTMLElement;
    const modal = container.querySelector('.settings-modal') as HTMLElement;

    fireEvent.click(modal);
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(overlay);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

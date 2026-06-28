import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AiConsentModal } from './AiConsentModal';

describe('AiConsentModal', () => {
  it('renders the disclosure and auto-focuses the accept button', () => {
    render(<AiConsentModal onAccept={() => {}} onCancel={() => {}} />);
    expect(screen.getByText('AI Data Sharing Notice')).toBeTruthy();
    expect(document.activeElement?.textContent).toBe('Agree & Continue');
  });

  it('Accept button triggers onAccept', () => {
    const onAccept = vi.fn();
    render(<AiConsentModal onAccept={onAccept} onCancel={() => {}} />);
    fireEvent.click(screen.getByText('Agree & Continue'));
    expect(onAccept).toHaveBeenCalledTimes(1);
  });

  it('Cancel button triggers onCancel', () => {
    const onCancel = vi.fn();
    render(<AiConsentModal onAccept={() => {}} onCancel={onCancel} />);
    fireEvent.click(screen.getByText('Cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('Escape key triggers onCancel', () => {
    const onCancel = vi.fn();
    render(<AiConsentModal onAccept={() => {}} onCancel={onCancel} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CustomThemeCreator } from './CustomThemeCreator';
import { nameToKey } from './nameToKey';
import { tauriService } from '../../services/tauriService';
import type { Theme } from '../../types/appTypes';

vi.mock('../../services/tauriService', () => ({
  tauriService: {
    saveCustomTheme: vi.fn(),
  },
}));

const makeTheme = (name: string): Theme => ({
  name,
  variables: { 'bg-primary': '#000000', 'text-primary': '#ffffff' },
  terminal: {
    foreground: '#ffffff',
    background: '#000000',
    backgroundInactive: '#111111',
    paneBackground: '#222222',
  },
});

const themesData = {
  dark: makeTheme('Dark'),
  medium: makeTheme('Medium'),
  light: makeTheme('Light'),
};

describe('nameToKey', () => {
  it('lowercases and replaces spaces with underscores', () => {
    expect(nameToKey('My Theme')).toBe('my_theme');
  });
  it('strips forbidden characters', () => {
    expect(nameToKey('foo!@#bar')).toBe('foobar');
  });
  it('keeps hyphens and underscores', () => {
    expect(nameToKey('my-theme_1')).toBe('my-theme_1');
  });
  it('returns empty for all-forbidden input', () => {
    expect(nameToKey('!!!')).toBe('');
  });
});

describe('CustomThemeCreator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.documentElement.style.cssText = '';
  });

  it('does not render when closed', () => {
    const { container } = render(
      <CustomThemeCreator
        isOpen={false}
        themesData={themesData}
        currentTheme="dark"
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders and shows a name input when open', () => {
    render(
      <CustomThemeCreator
        isOpen={true}
        themesData={themesData}
        currentTheme="dark"
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    expect(screen.getByText('Custom Theme Creator')).toBeTruthy();
    expect(screen.getByPlaceholderText(/My Dark Blue/i)).toBeTruthy();
  });

  it('rejects empty theme name on save', async () => {
    render(
      <CustomThemeCreator
        isOpen={true}
        themesData={themesData}
        currentTheme="dark"
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    fireEvent.click(screen.getByText('Save Theme'));
    await waitFor(() => {
      expect(screen.getByText(/Please enter a theme name/i)).toBeTruthy();
    });
    expect(vi.mocked(tauriService.saveCustomTheme)).not.toHaveBeenCalled();
  });

  it('rejects protected theme name', async () => {
    render(
      <CustomThemeCreator
        isOpen={true}
        themesData={themesData}
        currentTheme="dark"
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    const input = screen.getByPlaceholderText(/My Dark Blue/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'dark' } });
    fireEvent.click(screen.getByText('Save Theme'));
    await waitFor(() => {
      expect(screen.getByText(/Cannot use "dark"/i)).toBeTruthy();
    });
    expect(vi.mocked(tauriService.saveCustomTheme)).not.toHaveBeenCalled();
  });

  it('saves a valid custom theme and reports key', async () => {
    const onSave = vi.fn();
    vi.mocked(tauriService.saveCustomTheme).mockResolvedValue({ success: true });
    render(
      <CustomThemeCreator
        isOpen={true}
        themesData={themesData}
        currentTheme="dark"
        onSave={onSave}
        onCancel={vi.fn()}
      />
    );
    const input = screen.getByPlaceholderText(/My Dark Blue/i);
    fireEvent.change(input, { target: { value: 'My Blue' } });
    fireEvent.click(screen.getByText('Save Theme'));
    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith('my_blue');
    });
    expect(vi.mocked(tauriService.saveCustomTheme)).toHaveBeenCalledWith(
      'my_blue',
      expect.objectContaining({ name: 'My Blue' })
    );
  });

  it('restores variables on cancel after editing', async () => {
    const onCancel = vi.fn();
    render(
      <CustomThemeCreator
        isOpen={true}
        themesData={themesData}
        currentTheme="dark"
        onSave={vi.fn()}
        onCancel={onCancel}
      />
    );
    // Initial apply sets --bg-primary to #000000 from dark theme
    await waitFor(() => {
      expect(document.documentElement.style.getPropertyValue('--bg-primary')).toBe('#000000');
    });
    // Simulate edit by directly mutating DOM (real change would come through UI)
    document.documentElement.style.setProperty('--bg-primary', '#ff0000');
    fireEvent.click(screen.getByTitle('Cancel'));
    // On cancel, originalVariables should restore
    expect(document.documentElement.style.getPropertyValue('--bg-primary')).toBe('#000000');
    expect(onCancel).toHaveBeenCalled();
  });

  it('surfaces backend save error', async () => {
    vi.mocked(tauriService.saveCustomTheme).mockResolvedValue({ success: false, error: 'disk full' });
    render(
      <CustomThemeCreator
        isOpen={true}
        themesData={themesData}
        currentTheme="dark"
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    fireEvent.change(screen.getByPlaceholderText(/My Dark Blue/i), { target: { value: 'ok' } });
    fireEvent.click(screen.getByText('Save Theme'));
    await waitFor(() => {
      expect(screen.getByText(/disk full/i)).toBeTruthy();
    });
  });
});

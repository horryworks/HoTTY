import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AppearanceTab } from './AppearanceTab';
import { useSettingsStore } from '../../stores/settingsStore';
import { DEFAULT_THEME_IDS } from '../../themes/defaults';

describe('AppearanceTab', () => {
  beforeEach(() => {
    useSettingsStore.getState().reset();
  });

  it('renders an option per default theme id', () => {
    render(<AppearanceTab />);
    const select = screen.getAllByRole('combobox')[0] as HTMLSelectElement;
    expect(select.options.length).toBe(DEFAULT_THEME_IDS.length);
  });

  it('changing the theme updates the settings store', () => {
    render(<AppearanceTab />);
    const select = screen.getAllByRole('combobox')[0] as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'light' } });
    expect(useSettingsStore.getState().theme).toBe('light');
  });

  it('changing font size writes a number (or falls back to 14)', () => {
    render(<AppearanceTab />);
    const fontSizeInput = screen
      .getByText('Font size (px)')
      .parentElement!.querySelector('input') as HTMLInputElement;
    fireEvent.change(fontSizeInput, { target: { value: '20' } });
    expect(useSettingsStore.getState().fontSize).toBe(20);

    fireEvent.change(fontSizeInput, { target: { value: 'abc' } });
    expect(useSettingsStore.getState().fontSize).toBe(14);
  });

  it('switching sidebar position via radio updates the store', () => {
    render(<AppearanceTab />);
    fireEvent.click(screen.getByLabelText('right'));
    expect(useSettingsStore.getState().sidebarPosition).toBe('right');
  });
});

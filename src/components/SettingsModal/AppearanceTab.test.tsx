import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AppearanceTab } from './AppearanceTab';
import { useSettingsStore, DEFAULT_PROMPT_PATTERNS } from '../../stores/settingsStore';
import { DEFAULT_THEME_IDS, DEFAULT_THEMES } from '../../themes/defaults';

vi.mock('../../services/tauriService', () => ({
  tauriService: {
    listSystemFonts: vi.fn().mockResolvedValue([
      { family: 'Consolas' },
      { family: 'Courier New' },
    ]),
    // Background-image browse: the picker and the asset-URL conversion both go
    // through tauriService now rather than the Tauri API directly.
    selectImage: vi.fn().mockResolvedValue(null),
    toAssetUrl: (path: string) => `asset://localhost/${encodeURIComponent(path)}`,
  },
}));

function renderTab() {
  return render(
    <AppearanceTab
      themesData={DEFAULT_THEMES}
      onOpenCustomThemeCreator={vi.fn()}
      onDeleteTheme={vi.fn()}
    />,
  );
}

describe('AppearanceTab', () => {
  beforeEach(() => {
    useSettingsStore.getState().reset();
    localStorage.clear();
  });

  it('renders an option per default theme id', () => {
    renderTab();
    // Theme is the second combobox (after font family)
    const selects = screen.getAllByRole('combobox');
    const themeSelect = selects.find((s) => {
      const options = Array.from((s as HTMLSelectElement).options);
      return options.some((o) => o.value === 'dark');
    }) as HTMLSelectElement;
    expect(themeSelect.options.length).toBe(DEFAULT_THEME_IDS.length);
  });

  it('changing the theme updates the settings store', () => {
    renderTab();
    const selects = screen.getAllByRole('combobox');
    const themeSelect = selects.find((s) => {
      const options = Array.from((s as HTMLSelectElement).options);
      return options.some((o) => o.value === 'dark');
    }) as HTMLSelectElement;
    fireEvent.change(themeSelect, { target: { value: 'light' } });
    expect(useSettingsStore.getState().theme).toBe('light');
  });

  it('changing font size writes a number (or falls back to 14)', () => {
    renderTab();
    const fontSizeInput = screen
      .getByText('Font size (px)')
      .parentElement!.querySelector('input') as HTMLInputElement;
    fireEvent.change(fontSizeInput, { target: { value: '20' } });
    expect(useSettingsStore.getState().fontSize).toBe(20);

    fireEvent.change(fontSizeInput, { target: { value: 'abc' } });
    expect(useSettingsStore.getState().fontSize).toBe(14);
  });

  it('switching sidebar position via radio updates the store', () => {
    renderTab();
    fireEvent.click(screen.getByLabelText('right'));
    expect(useSettingsStore.getState().sidebarPosition).toBe('right');
  });

  it('renders the prompt highlight checkbox', () => {
    renderTab();
    const checkbox = screen.getByLabelText('Enable User Input Highlight');
    expect(checkbox).toBeTruthy();
  });

  it('toggling prompt highlight updates the store', () => {
    renderTab();
    const checkbox = screen.getByLabelText('Enable User Input Highlight') as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    fireEvent.click(checkbox);
    expect(useSettingsStore.getState().enablePromptHighlight).toBe(false);
  });

  it('shows prompt patterns list when enabled', () => {
    renderTab();
    expect(screen.getByText('Prompt Patterns (Regex)')).toBeTruthy();
    for (const p of DEFAULT_PROMPT_PATTERNS) {
      expect(screen.getByDisplayValue(p.name)).toBeTruthy();
    }
  });

  it('hides prompt patterns when disabled', () => {
    useSettingsStore.getState().update('enablePromptHighlight', false);
    renderTab();
    expect(screen.queryByText('Prompt Patterns (Regex)')).toBeNull();
  });

  it('add pattern button appends a new pattern', () => {
    renderTab();
    const addButton = screen.getByText('+ Add Pattern');
    fireEvent.click(addButton);
    const patterns = useSettingsStore.getState().promptPatterns;
    expect(patterns.length).toBe(DEFAULT_PROMPT_PATTERNS.length + 1);
    expect(patterns[patterns.length - 1].name).toBe('New Pattern');
  });

  it('reset to default restores original patterns', () => {
    useSettingsStore.getState().update('promptPatterns', [{ id: 'x', name: 'X', pattern: 'x' }]);
    renderTab();
    fireEvent.click(screen.getByText('Reset to Default'));
    expect(useSettingsStore.getState().promptPatterns).toEqual(DEFAULT_PROMPT_PATTERNS);
  });

  it('renders encoding radio buttons', () => {
    renderTab();
    expect(screen.getByLabelText('utf8')).toBeTruthy();
    expect(screen.getByLabelText('shift_jis')).toBeTruthy();
    expect(screen.getByLabelText('euc-jp')).toBeTruthy();
  });

  it('changing encoding updates the store', () => {
    renderTab();
    fireEvent.click(screen.getByLabelText('shift_jis'));
    expect(useSettingsStore.getState().globalEncoding).toBe('shift_jis');
  });

  it('renders the font family dropdown with system monospace default', () => {
    renderTab();
    const selects = screen.getAllByRole('combobox');
    const fontSelect = selects.find((s) => {
      const options = Array.from((s as HTMLSelectElement).options);
      return options.some((o) => o.text === 'System Monospace (default)');
    }) as HTMLSelectElement;
    expect(fontSelect).toBeTruthy();
  });

  it('renders the Rescan button after fonts load', async () => {
    renderTab();
    await waitFor(() => {
      expect(screen.getByText('Rescan')).toBeTruthy();
    });
  });
});

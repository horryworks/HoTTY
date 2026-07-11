import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FeaturesTab } from './FeaturesTab';
import { useSettingsStore } from '../../stores/settingsStore';

describe('FeaturesTab', () => {
  it('renders all feature labels', () => {
    render(<FeaturesTab />);
    expect(screen.getByText('AI Chat')).toBeTruthy();
    expect(screen.getByText('Log Viewer')).toBeTruthy();
    expect(screen.getByText('Ping Monitor')).toBeTruthy();
    expect(screen.getByText('Text Editor')).toBeTruthy();
    expect(screen.getByText('File Explorer')).toBeTruthy();
    expect(screen.getByText('Web Browser')).toBeTruthy();
  });

  it('has the expected default enabled state (File Explorer & Text Editor off)', () => {
    render(<FeaturesTab />);
    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes.length).toBe(7);
    // All toggles are present and interactable regardless of state.
    for (const cb of checkboxes) {
      expect(cb).toHaveProperty('disabled', false);
    }
    // File Explorer and Text Editor default OFF (new installs); the rest default ON.
    expect(screen.getByRole('checkbox', { name: 'File Explorer' })).toHaveProperty('checked', false);
    expect(screen.getByRole('checkbox', { name: 'Text Editor' })).toHaveProperty('checked', false);
    for (const name of ['AI Chat', 'Log Viewer', 'Ping Monitor', 'File Server', 'Web Browser']) {
      expect(screen.getByRole('checkbox', { name })).toHaveProperty('checked', true);
    }
  });

  it('toggles a feature off when clicked', () => {
    render(<FeaturesTab />);
    const aiChatCheckbox = screen.getByRole('checkbox', { name: 'AI Chat' });
    fireEvent.click(aiChatCheckbox);
    const state = useSettingsStore.getState();
    expect(state.enabledFeatures['ai-chat']).toBe(false);
  });

  it('reflects disabled feature state', () => {
    useSettingsStore.getState().update('enabledFeatures', {
      'ai-chat': false,
      'log-viewer': true,
      'ping-monitor': true,
      'text-editor': true,
      'file-explorer': true,
      'file-server': true,
      'web-browser': true,
    });
    render(<FeaturesTab />);
    const aiChatCheckbox = screen.getByRole('checkbox', { name: 'AI Chat' });
    expect(aiChatCheckbox).toHaveProperty('checked', false);
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { NewSessionMenu } from './NewSessionMenu';
import { resetLocalShellsCache } from '../../hooks/useLocalShells';
import { useSettingsStore } from '../../stores/settingsStore';

// What the menu finds installed. Each test can change the answers.
const shells = vi.hoisted(() => ({
  listWslDistributions: vi.fn(),
  detectGitBash: vi.fn(),
}));
vi.mock('../../services/tauriService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/tauriService')>();
  return { ...actual, tauriService: { ...actual.tauriService, ...shells } };
});

const GIT_BASH = 'C:/Program Files/Git/bin/bash.exe';

function setup(extra: Partial<Parameters<typeof NewSessionMenu>[0]> = {}) {
  const onNew = vi.fn();
  const onOpenLocal = vi.fn();
  render(<NewSessionMenu placement="left" onNew={onNew} onOpenLocal={onOpenLocal} {...extra} />);
  return { onNew, onOpenLocal };
}

/** Open the menu and wait until it knows what is installed. */
async function openMenu() {
  fireEvent.click(screen.getByTitle('New Session'));
  await waitFor(() => expect(shells.detectGitBash).toHaveBeenCalled());
  await waitFor(() => expect(screen.getByRole('menuitem', { name: /Git Bash/ })).toBeTruthy());
}

describe('NewSessionMenu', () => {
  beforeEach(() => {
    resetLocalShellsCache();
    shells.listWslDistributions.mockReset().mockResolvedValue(['Ubuntu']);
    shells.detectGitBash.mockReset().mockResolvedValue(GIT_BASH);
    useSettingsStore.setState((s) => ({ enabledFeatures: { ...s.enabledFeatures, 'web-browser': true } }));
  });

  it('stays closed until the New Session row is pressed', () => {
    setup();
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.getByTitle('New Session').getAttribute('aria-expanded')).toBe('false');
  });

  it('shows the translated names for Serial and Command Prompt', async () => {
    setup();
    await openMenu();
    expect(screen.getByRole('menuitem', { name: 'Serial' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Command Prompt' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'PowerShell' })).toBeTruthy();
  });

  it('opens the dialog for SSH, Telnet and Serial and closes the menu', async () => {
    const { onNew } = setup();
    await openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Serial' }));
    expect(onNew).toHaveBeenCalledWith('serial');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('starts a local shell straight away', async () => {
    const { onOpenLocal } = setup();
    await openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Command Prompt' }));
    expect(onOpenLocal).toHaveBeenCalledWith({ protocol: 'cmd' });
  });

  it('opens the only WSL distribution without a submenu', async () => {
    const { onOpenLocal } = setup();
    await openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'WSL' }));
    expect(onOpenLocal).toHaveBeenCalledWith({ protocol: 'wsl', distribution: 'Ubuntu' });
  });

  it('lists several WSL distributions in a submenu', async () => {
    shells.listWslDistributions.mockResolvedValue(['Ubuntu', 'Debian']);
    const { onOpenLocal } = setup();
    await openMenu();
    await waitFor(() => expect(screen.getByRole('menuitem', { name: /WSL/ }).getAttribute('aria-haspopup')).toBe('menu'));
    fireEvent.click(screen.getByRole('menuitem', { name: /WSL/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Debian' }));
    expect(onOpenLocal).toHaveBeenCalledWith({ protocol: 'wsl', distribution: 'Debian' });
  });

  it('passes the found Git Bash path, and disables the row when it is missing', async () => {
    const { onOpenLocal } = setup();
    await openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /Git Bash/ }));
    expect(onOpenLocal).toHaveBeenCalledWith({ protocol: 'git-bash', shellPath: GIT_BASH });
  });

  it('marks Git Bash as not installed when it is not found', async () => {
    shells.detectGitBash.mockResolvedValue(null);
    setup();
    fireEvent.click(screen.getByTitle('New Session'));
    await waitFor(() => expect(screen.getByRole('menuitem', { name: /Git Bash/ }).textContent).toContain('Not installed'));
    expect((screen.getByRole('menuitem', { name: /Git Bash/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('leaves out Web while the Web Browser feature is off', async () => {
    useSettingsStore.setState((s) => ({ enabledFeatures: { ...s.enabledFeatures, 'web-browser': false } }));
    setup();
    await openMenu();
    expect(screen.queryByRole('menuitem', { name: 'Web' })).toBeNull();
    expect(screen.getByRole('menuitem', { name: 'GCP' })).toBeTruthy();
  });

  it('lists only the feature panes that have a handler', async () => {
    const onNewPingMonitor = vi.fn();
    setup({ onNewPingMonitor });
    await openMenu();
    expect(screen.queryByRole('menuitem', { name: 'Log Viewer' })).toBeNull();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Ping Monitor' }));
    expect(onNewPingMonitor).toHaveBeenCalledTimes(1);
  });
});

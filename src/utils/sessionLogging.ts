import { tauriService } from '../services/tauriService';
import { useSettingsStore } from '../stores/settingsStore';

/**
 * Resolve the logging arguments for a `connect_session` call.
 *
 * Session logging is opt-in and the log FOLDER must be approved through a
 * native dialog (`confirm_log_dir`) — the backend rejects unapproved paths, and
 * routing the approval through a native dialog is what stops a compromised
 * renderer from silently growing the approval set (ADR-010). The dialog only
 * appears the first time a folder is used; later calls resolve immediately.
 *
 * Shared by `useSessionManager.openSession` (user-opened tabs) and
 * `useAiWorkerSessions.openWorkerSession` (AI-opened worker sessions) so both
 * kinds of session log — or don't — under exactly the same rule.
 */
export async function resolveLoggingForConnect(): Promise<{ enabled: boolean; path: string }> {
    const { loggingEnabled, loggingPath } = useSettingsStore.getState();
    if (!loggingEnabled || !loggingPath) return { enabled: false, path: '' };
    try {
        const approved = await tauriService.confirmLogDir(loggingPath);
        return approved ? { enabled: true, path: loggingPath } : { enabled: false, path: '' };
    } catch {
        return { enabled: false, path: '' };
    }
}

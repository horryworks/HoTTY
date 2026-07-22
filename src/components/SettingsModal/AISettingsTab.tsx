import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '../../stores/settingsStore';
import { useAiAuthStore } from '../../stores/aiAuthStore';
import { aiAuthLogin, aiAuthLogout, readStoredGeminiCredentials } from '../../hooks/useAiAuthOwner';
import { ConfirmModal } from '../ConfirmModal/ConfirmModal';
import HelpTooltip from '../HelpTooltip/HelpTooltip';
import { STORAGE_KEYS } from '../../constants/storage';
import { AI_PROVIDERS } from '../../constants/aiProviders';
import type { PersonaDefinition } from '../../types/appTypes';
import { DEFAULT_PERSONAS } from '../../stores/settingsStore';
import { DEFAULT_WHITELIST, DEFAULT_BLACKLIST } from '../../utils/commandLists';
import { AuthenticationPanel } from './AuthenticationPanel';
import { VertexAIAuthPanel } from './VertexAIAuthPanel';
import { OpenAIAuthPanel } from './OpenAIAuthPanel';
import { AnthropicAuthPanel } from './AnthropicAuthPanel';

export function AISettingsTab() {
  const settings = useSettingsStore();
  const update = settings.update;
  const { t } = useTranslation();

  const [showGeminiWarning, setShowGeminiWarning] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [activePersonaId, setActivePersonaId] = useState(settings.aiPersonas[0]?.id ?? '');
  const [newWhitelistEntry, setNewWhitelistEntry] = useState('');
  const [newBlacklistEntry, setNewBlacklistEntry] = useState('');

  // Auth state is owned window-wide by useAiAuthOwner (mounted in App); this
  // tab only reads the store and calls the aiAuthLogin/aiAuthLogout actions.
  const isAuthenticated = useAiAuthStore((s) => s.isAuthenticated);
  const isAuthLoading = useAiAuthStore((s) => s.isAuthLoading);
  const authErrorCode = useAiAuthStore((s) => s.authError);
  const authError = authErrorCode === 'timedOut'
    ? t('settings.ai.auth.timedOut')
    : authErrorCode === 'failed'
      ? t('settings.ai.auth.failed')
      : null;

  // Credential form state (persisted values pre-filled like the old pane form).
  const [geminiClientId, setGeminiClientId] = useState('');
  const [geminiClientSecret, setGeminiClientSecret] = useState('');
  const [vertexProjectId, setVertexProjectId] = useState(
    () => localStorage.getItem(STORAGE_KEYS.VERTEXAI_PROJECT_ID) || ''
  );
  const [vertexLocation, setVertexLocation] = useState(
    () => localStorage.getItem(STORAGE_KEYS.VERTEXAI_LOCATION) || ''
  );
  const [vertexAuthType, setVertexAuthType] = useState<'adc' | 'service_account'>(
    () => (localStorage.getItem(STORAGE_KEYS.VERTEXAI_AUTH_TYPE) as 'adc' | 'service_account') || 'adc'
  );
  const [vertexKeyFilePath, setVertexKeyFilePath] = useState(
    () => localStorage.getItem(STORAGE_KEYS.VERTEXAI_KEY_FILE_PATH) || ''
  );
  const [openaiApiKey, setOpenaiApiKey] = useState('');
  const [anthropicApiKey, setAnthropicApiKey] = useState('');

  // Pre-fill the Gemini form from the DPAPI-encrypted stored credentials — only
  // when the Gemini form is actually on screen (that provider selected and not
  // yet authenticated), and never overwriting what the user has already typed.
  useEffect(() => {
    if (settings.activeAiProvider !== 'gemini' || isAuthenticated) return;
    let cancelled = false;
    (async () => {
      try {
        const creds = await readStoredGeminiCredentials();
        if (cancelled || !creds) return;
        setGeminiClientId((prev) => prev || creds.clientId);
        setGeminiClientSecret((prev) => prev || creds.clientSecret);
      } catch { /* leave the fields empty */ }
    })();
    return () => { cancelled = true; };
  }, [settings.activeAiProvider, isAuthenticated]);

  const handleLogin = () => {
    const provider = settings.activeAiProvider;
    if (provider === 'vertexai') {
      void aiAuthLogin({
        provider: 'vertexai',
        projectId: vertexProjectId,
        location: vertexLocation,
        authType: vertexAuthType,
        keyFilePath: vertexKeyFilePath || undefined,
      });
    } else if (provider === 'openai') {
      void aiAuthLogin({ provider: 'openai', apiKey: openaiApiKey });
    } else if (provider === 'anthropic') {
      void aiAuthLogin({ provider: 'anthropic', apiKey: anthropicApiKey });
    } else {
      void aiAuthLogin({ provider: 'gemini', clientId: geminiClientId, clientSecret: geminiClientSecret });
    }
  };

  const personas = settings.aiPersonas;
  const activePersona = personas.find(p => p.id === activePersonaId) ?? personas[0];
  const activeTabId = activePersona?.id ?? '';

  // Horizontal scroll for persona tabs
  const tabsRef = useRef<HTMLDivElement>(null);
  const isDraggingTab = useRef(false);
  const tabStartX = useRef(0);
  const tabScrollLeft = useRef(0);

  const handleTabMouseDown = (e: React.MouseEvent) => {
    isDraggingTab.current = true;
    if (tabsRef.current) {
      tabStartX.current = e.pageX - tabsRef.current.offsetLeft;
      tabScrollLeft.current = tabsRef.current.scrollLeft;
    }
  };
  const handleTabMouseLeave = () => { isDraggingTab.current = false; };
  const handleTabMouseUp = () => { isDraggingTab.current = false; };
  const handleTabMouseMove = (e: React.MouseEvent) => {
    if (!isDraggingTab.current || !tabsRef.current) return;
    e.preventDefault();
    const x = e.pageX - tabsRef.current.offsetLeft;
    const walk = (x - tabStartX.current) * 2;
    tabsRef.current.scrollLeft = tabScrollLeft.current - walk;
  };

  const updatePersona = (personaId: string, updates: Partial<PersonaDefinition>) => {
    const newPersonas = personas.map(p =>
      p.id === personaId ? { ...p, ...updates } : p
    );
    update('aiPersonas', newPersonas);
  };

  return (
    <>
      {/* -- AI Provider -- */}
      <div className="settings-card">
      <h3 className="settings-section-title settings-section-title--first">{t('settings.ai.providerSection')}</h3>
      <div className="settings-group">
        <label>
          {t('settings.ai.aiProvider')}
          <HelpTooltip text={t('settings.ai.aiProviderHelp')} />
        </label>
        <select
          value={settings.activeAiProvider}
          onChange={(e) => {
            const provider = e.target.value;
            // The window's auth owner (useAiAuthOwner) reacts to this change:
            // it switches the backend provider and attempts silent re-auth.
            update('activeAiProvider', provider);
            if (provider === 'gemini') {
              setShowGeminiWarning(true);
            }
          }}
          style={{ width: '220px' }}
        >
          {AI_PROVIDERS.map((p) => (
            <option key={p.id} value={p.id}>{t(p.labelKey)}</option>
          ))}
        </select>
      </div>

      {/* -- Authentication -- */}
      <div className="settings-group" style={{ marginBottom: '15px' }}>
        <label>{t('settings.ai.authentication')}</label>
        <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{
              width: '10px',
              height: '10px',
              borderRadius: '50%',
              backgroundColor: isAuthenticated ? 'var(--success-color)' : 'var(--color-danger)'
            }} />
            <span>{isAuthenticated ? t('settings.ai.authenticated') : t('settings.ai.notAuthenticated')}</span>
          </div>
          {isAuthenticated && (
            <button
              className="settings-button"
              onClick={() => setShowLogoutConfirm(true)}
            >
              {t('settings.ai.logout')}
            </button>
          )}
        </div>
      </div>

      {/* -- Sign-in form for the selected provider -- */}
      {!isAuthenticated && (
        settings.activeAiProvider === 'vertexai' ? (
          <VertexAIAuthPanel
            projectId={vertexProjectId}
            setProjectId={setVertexProjectId}
            location={vertexLocation}
            setLocation={setVertexLocation}
            authType={vertexAuthType}
            setAuthType={setVertexAuthType}
            keyFilePath={vertexKeyFilePath}
            setKeyFilePath={setVertexKeyFilePath}
            isAuthLoading={isAuthLoading}
            onLogin={handleLogin}
            authError={authError}
          />
        ) : settings.activeAiProvider === 'openai' ? (
          <OpenAIAuthPanel
            apiKey={openaiApiKey}
            setApiKey={setOpenaiApiKey}
            isAuthLoading={isAuthLoading}
            onLogin={handleLogin}
            authError={authError}
          />
        ) : settings.activeAiProvider === 'anthropic' ? (
          <AnthropicAuthPanel
            apiKey={anthropicApiKey}
            setApiKey={setAnthropicApiKey}
            isAuthLoading={isAuthLoading}
            onLogin={handleLogin}
            authError={authError}
          />
        ) : (
          <AuthenticationPanel
            clientId={geminiClientId}
            setClientId={setGeminiClientId}
            clientSecret={geminiClientSecret}
            setClientSecret={setGeminiClientSecret}
            isAuthLoading={isAuthLoading}
            onLogin={handleLogin}
            authError={authError}
          />
        )
      )}

      </div>

      {/* -- Personas -- */}
      <div className="settings-card">
      <h3 className="settings-section-title">{t('settings.ai.personasSection')}</h3>
      <div
        className="settings-modal-tabs"
        ref={tabsRef}
        style={{ overflowX: 'auto', flexWrap: 'nowrap', marginBottom: 0 }}
        onMouseDown={handleTabMouseDown}
        onMouseLeave={handleTabMouseLeave}
        onMouseUp={handleTabMouseUp}
        onMouseMove={handleTabMouseMove}
      >
        {personas.map(persona => (
          <button
            key={persona.id}
            type="button"
            className={`settings-modal-tab${activeTabId === persona.id ? ' active' : ''}`}
            onClick={() => setActivePersonaId(persona.id)}
          >
            {persona.label}
          </button>
        ))}
        <button
          type="button"
          className="settings-modal-tab"
          onClick={() => {
            const id = crypto.randomUUID();
            const newPersona: PersonaDefinition = {
              id,
              label: t('settings.ai.newPersonaLabel'),
              systemPrompt: 'You are a helpful assistant.',
            };
            update('aiPersonas', [...personas, newPersona]);
            setActivePersonaId(id);
          }}
          title={t('settings.ai.addPersona')}
        >
          +
        </button>
      </div>

      {/* -- Active Persona Content -- */}
      {activePersona && (
        <div className="ai-settings-persona-content">
          {/* Persona Name */}
          <div className="settings-group">
            <label>{t('settings.ai.personaName')}</label>
            <input
              type="text"
              value={activePersona.label}
              onChange={(e) => updatePersona(activeTabId, { label: e.target.value })}
              placeholder={t('settings.ai.displayNamePlaceholder')}
            />
          </div>

          {/* System Prompt */}
          <div className="settings-group">
            <label>{t('settings.ai.systemPrompt')}</label>
            <textarea
              value={activePersona.systemPrompt}
              onChange={(e) => updatePersona(activeTabId, { systemPrompt: e.target.value })}
              placeholder={t('settings.ai.systemPromptPlaceholder')}
              className="ai-settings-textarea"
              rows={3}
            />
          </div>

          {/* Delete Persona */}
          <div style={{ textAlign: 'right', marginTop: '10px' }}>
            <button
              className="ai-settings-delete-btn"
              style={{ padding: '6px 12px' }}
              onClick={() => {
                if (personas.length <= 1) return;
                const newPersonas = personas.filter(p => p.id !== activeTabId);
                update('aiPersonas', newPersonas);
                setActivePersonaId(newPersonas[0].id);
              }}
              disabled={personas.length <= 1}
              title={personas.length <= 1 ? t('settings.ai.atLeastOnePersona') : t('settings.ai.deletePersonaTitle', { label: activePersona.label })}
            >
              {t('settings.ai.deletePersona')}
            </button>
          </div>
        </div>
      )}

      {/* -- Reset All Personas -- */}
      <div style={{ marginTop: '10px', marginBottom: '15px' }}>
        <button
          className="ai-settings-delete-btn"
          style={{ padding: '6px 12px' }}
          onClick={() => {
            update('aiPersonas', [...DEFAULT_PERSONAS]);
            setActivePersonaId(DEFAULT_PERSONAS[0].id);
          }}
        >
          {t('settings.ai.resetAllPersonas')}
        </button>
      </div>

      </div>

      {/* -- Command Execution -- */}
      <div className="settings-card">
      <h3 className="settings-section-title">{t('settings.ai.commandExecutionSection')}</h3>
      <p className="settings-help-text" style={{ marginBottom: '10px' }}>
        {t('settings.ai.commandExecutionHelp')}
      </p>

      {/* Command safety classifier */}
      <div className="settings-group">
        <label>
          {t('settings.ai.commandSafetyClassifier')}
          <HelpTooltip text={t('settings.ai.commandSafetyClassifierHelp')} />
        </label>
        <select
          value={settings.classifierStrategy}
          onChange={(e) => update('classifierStrategy', e.target.value as typeof settings.classifierStrategy)}
        >
          <option value="static">{t('settings.ai.classifierStatic')}</option>
          <option value="ai">{t('settings.ai.classifierAi')}</option>
          <option value="hybrid">{t('settings.ai.classifierHybrid')}</option>
        </select>
      </div>

      {/* AI confidence threshold (only relevant when AI judges commands) */}
      {settings.classifierStrategy !== 'static' && (
        <div className="settings-group">
          <label>
            {t('settings.ai.aiConfidenceThreshold', { percent: Math.round(settings.aiClassifyConfidenceThreshold * 100) })}
            <HelpTooltip text={t('settings.ai.aiConfidenceThresholdHelp')} />
          </label>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={settings.aiClassifyConfidenceThreshold}
            onChange={(e) => update('aiClassifyConfidenceThreshold', parseFloat(e.target.value))}
          />
        </div>
      )}

      {/* Auto-execute pre-run countdown (grace period before a safe command runs) */}
      <div className="settings-group">
        <label>
          {t('settings.ai.autoExecCountdown')}
          <HelpTooltip text={t('settings.ai.autoExecCountdownHelp')} />
        </label>
        <input
          type="number"
          min={0}
          max={10}
          value={settings.aiAutoExecCountdownSecs}
          onChange={(e) => {
            const parsed = parseInt(e.target.value, 10);
            update('aiAutoExecCountdownSecs', Number.isFinite(parsed) ? Math.max(0, Math.min(10, parsed)) : 0);
          }}
        />
      </div>

      {/* Concurrent AI Chat streams per pane (1 = strictly serial) */}
      <div className="settings-group">
        <label>
          {t('settings.ai.concurrentStreams')}
          <HelpTooltip text={t('settings.ai.concurrentStreamsHelp')} />
        </label>
        <input
          type="number"
          min={1}
          max={8}
          value={settings.maxConcurrentStreams}
          onChange={(e) => {
            const parsed = parseInt(e.target.value, 10);
            update('maxConcurrentStreams', Number.isFinite(parsed) ? Math.max(1, Math.min(8, parsed)) : 1);
          }}
        />
      </div>

      {/* Device Response Timeout */}
      <div className="settings-group">
        <label>
          {t('settings.ai.deviceResponseTimeout')}
          <HelpTooltip text={t('settings.ai.deviceResponseTimeoutHelp')} />
        </label>
        <input
          type="number"
          min={0}
          max={600}
          value={settings.aiCommandIdleTimeoutSecs}
          onChange={(e) => {
            const parsed = parseInt(e.target.value, 10);
            update('aiCommandIdleTimeoutSecs', Number.isFinite(parsed) && parsed > 0 ? parsed : 0);
          }}
        />
      </div>

      {/* Client-side sleep delay */}
      <div className="settings-group">
        <label className="settings-checkbox">
          <input
            type="checkbox"
            checked={settings.aiSleepAsClientDelay}
            onChange={(e) => update('aiSleepAsClientDelay', e.target.checked)}
          />
          {t('settings.ai.sleepAsClientDelay')}
          <HelpTooltip text={t('settings.ai.sleepAsClientDelayHelp')} />
        </label>
        <label>
          {t('settings.ai.maxClientDelay')}
          <HelpTooltip text={t('settings.ai.maxClientDelayHelp')} />
        </label>
        <input
          type="number"
          min={0}
          max={86400}
          value={settings.aiSleepMaxDelaySecs}
          disabled={!settings.aiSleepAsClientDelay}
          onChange={(e) => {
            const parsed = parseInt(e.target.value, 10);
            update('aiSleepMaxDelaySecs', Number.isFinite(parsed) && parsed > 0 ? parsed : 0);
          }}
        />
      </div>

      {/* Whitelist — auto-execute */}
      <div className="settings-group">
        <label>
          {t('settings.ai.whitelist')}
          <HelpTooltip text={t('settings.ai.whitelistHelp')} />
        </label>
        <div style={{ display: 'flex', gap: '8px' }}>
          <input
            type="text"
            value={newWhitelistEntry}
            onChange={(e) => setNewWhitelistEntry(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newWhitelistEntry.trim()) {
                const cmd = newWhitelistEntry.trim().toLowerCase();
                if (!settings.whitelistCommands.includes(cmd)) {
                  update('whitelistCommands', [...settings.whitelistCommands, cmd]);
                }
                setNewWhitelistEntry('');
              }
            }}
            placeholder={t('settings.ai.whitelistPlaceholder')}
            style={{ flex: 1 }}
          />
          <button
            className="settings-button"
            onClick={() => {
              const cmd = newWhitelistEntry.trim().toLowerCase();
              if (cmd && !settings.whitelistCommands.includes(cmd)) {
                update('whitelistCommands', [...settings.whitelistCommands, cmd]);
              }
              setNewWhitelistEntry('');
            }}
            disabled={!newWhitelistEntry.trim()}
          >
            {t('settings.ai.add')}
          </button>
          <button
            className="settings-button"
            onClick={() => update('whitelistCommands', [...DEFAULT_WHITELIST])}
            title={t('settings.ai.resetWhitelistTitle')}
          >
            {t('settings.ai.resetToDefaults')}
          </button>
        </div>
        {settings.whitelistCommands.length > 0 && (
          <div className="ai-settings-tag-list">
            {settings.whitelistCommands.map((cmd) => (
              <span key={cmd} className="ai-settings-tag">
                {cmd}
                <button
                  onClick={() => update('whitelistCommands', settings.whitelistCommands.filter(c => c !== cmd))}
                  title={t('settings.ai.removeEntry', { cmd })}
                >
                  &#10005;
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Blacklist — ask before execute */}
      <div className="settings-group">
        <label>
          {t('settings.ai.blacklist')}
          <HelpTooltip text={t('settings.ai.blacklistHelp')} />
        </label>
        <div style={{ display: 'flex', gap: '8px' }}>
          <input
            type="text"
            value={newBlacklistEntry}
            onChange={(e) => setNewBlacklistEntry(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newBlacklistEntry.trim()) {
                const cmd = newBlacklistEntry.trim().toLowerCase();
                if (!settings.blacklistCommands.includes(cmd)) {
                  update('blacklistCommands', [...settings.blacklistCommands, cmd]);
                }
                setNewBlacklistEntry('');
              }
            }}
            placeholder={t('settings.ai.blacklistPlaceholder')}
            style={{ flex: 1 }}
          />
          <button
            className="settings-button"
            onClick={() => {
              const cmd = newBlacklistEntry.trim().toLowerCase();
              if (cmd && !settings.blacklistCommands.includes(cmd)) {
                update('blacklistCommands', [...settings.blacklistCommands, cmd]);
              }
              setNewBlacklistEntry('');
            }}
            disabled={!newBlacklistEntry.trim()}
          >
            {t('settings.ai.add')}
          </button>
          <button
            className="settings-button"
            onClick={() => update('blacklistCommands', [...DEFAULT_BLACKLIST])}
            title={t('settings.ai.resetBlacklistTitle')}
          >
            {t('settings.ai.resetToDefaults')}
          </button>
        </div>
        {settings.blacklistCommands.length > 0 && (
          <div className="ai-settings-tag-list">
            {settings.blacklistCommands.map((cmd) => (
              <span key={cmd} className="ai-settings-tag">
                {cmd}
                <button
                  onClick={() => update('blacklistCommands', settings.blacklistCommands.filter(c => c !== cmd))}
                  title={t('settings.ai.removeEntry', { cmd })}
                >
                  &#10005;
                </button>
              </span>
            ))}
          </div>
        )}
      </div>
      </div>

      {/* -- Data Handling -- */}
      <div className="settings-card">
      <h3 className="settings-section-title">{t('settings.ai.dataHandlingSection')}</h3>
      <p className="settings-help-text" style={{ marginBottom: '10px' }}>
        {t('settings.ai.dataHandlingHelp')}
      </p>
      <ul className="settings-help-text" style={{ margin: '0 0 12px 0', paddingLeft: '20px', lineHeight: 1.5 }}>
        <li>{t('settings.ai.dataHandlingBulletProviders')}</li>
        <li>{t('settings.ai.dataHandlingBulletWhen')}</li>
        <li>{t('settings.ai.dataHandlingBulletRedaction')}</li>
      </ul>
      <div className="settings-group">
        <label>
          {t('settings.ai.dataConsentStatus')}
          <HelpTooltip text={t('settings.ai.resetDataConsentHelp')} />
        </label>
        <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{
              width: '10px',
              height: '10px',
              borderRadius: '50%',
              backgroundColor: settings.aiDataConsentAccepted ? 'var(--success-color)' : 'var(--text-tertiary)',
            }} />
            <span>
              {settings.aiDataConsentAccepted
                ? t('settings.ai.dataConsentAccepted')
                : t('settings.ai.dataConsentNotAccepted')}
            </span>
          </div>
          {settings.aiDataConsentAccepted && (
            <button
              className="settings-button"
              onClick={() => update('aiDataConsentAccepted', false)}
            >
              {t('settings.ai.resetDataConsent')}
            </button>
          )}
        </div>
      </div>
      </div>

      {/* -- Modals -- */}
      {showGeminiWarning && (
        <ConfirmModal
          title={t('settings.ai.privacyNoticeTitle')}
          message={t('settings.ai.privacyNoticeMessage')}
          confirmLabel={t('settings.ai.privacyNoticeConfirm')}
          onConfirm={() => setShowGeminiWarning(false)}
          onCancel={() => setShowGeminiWarning(false)}
        />
      )}
      {showLogoutConfirm && (
        <ConfirmModal
          title={t('settings.ai.logoutTitle')}
          message={t('settings.ai.logoutMessage')}
          confirmLabel={t('settings.ai.logoutConfirm')}
          onConfirm={async () => {
            setShowLogoutConfirm(false);
            // Sets the one-shot explicit-logout flag, drops backend credentials,
            // and broadcasts ai-auth-logout so every pane/window updates.
            await aiAuthLogout();
          }}
          onCancel={() => setShowLogoutConfirm(false)}
        />
      )}
    </>
  );
}

import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '../../stores/settingsStore';
import { tauriService } from '../../services/tauriService';
import { ConfirmModal } from '../ConfirmModal/ConfirmModal';
import HelpTooltip from '../HelpTooltip/HelpTooltip';
import { STORAGE_KEYS } from '../../constants/storage';
import type { PersonaDefinition } from '../../types/appTypes';
import { DEFAULT_PERSONAS } from '../../stores/settingsStore';
import { DEFAULT_WHITELIST, DEFAULT_BLACKLIST } from '../../utils/commandLists';

export function AISettingsTab() {
  const settings = useSettingsStore();
  const update = settings.update;
  const { t } = useTranslation();

  const [showGeminiWarning, setShowGeminiWarning] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [activePersonaId, setActivePersonaId] = useState(settings.aiPersonas[0]?.id ?? '');
  const [newWhitelistEntry, setNewWhitelistEntry] = useState('');
  const [newBlacklistEntry, setNewBlacklistEntry] = useState('');

  // Check auth status on mount
  useEffect(() => {
    tauriService.aiAuthStatus().then((s) => setIsAuthenticated(s.authenticated)).catch(() => {});
  }, []);

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
          onChange={async (e) => {
            const provider = e.target.value;
            update('activeAiProvider', provider);
            try {
              await tauriService.aiSetProvider(provider);
              const status = await tauriService.aiAuthStatus();
              setIsAuthenticated(status.authenticated);
            } catch { /* ignore */ }
            if (provider === 'gemini') {
              setShowGeminiWarning(true);
            }
          }}
          style={{ width: '220px' }}
        >
          <option value="vertexai">{t('settings.ai.providerVertexAi')}</option>
          <option value="gemini">{t('settings.ai.providerGemini')}</option>
          <option value="anthropic">{t('settings.ai.providerAnthropic')}</option>
          <option value="openai">{t('settings.ai.providerOpenai')}</option>
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
            localStorage.setItem(STORAGE_KEYS.AI_EXPLICIT_LOGOUT, '1');
            await tauriService.aiAuthLogout();
            setIsAuthenticated(false);
          }}
          onCancel={() => setShowLogoutConfirm(false)}
        />
      )}
    </>
  );
}

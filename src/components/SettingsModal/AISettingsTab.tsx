import { useState, useRef, useEffect } from 'react';
import { useSettingsStore } from '../../stores/settingsStore';
import { tauriService } from '../../services/tauriService';
import { ConfirmModal } from '../ConfirmModal/ConfirmModal';
import HelpTooltip from '../HelpTooltip/HelpTooltip';
import { STORAGE_KEYS } from '../../constants/storage';
import type { PersonaDefinition, AskAiCommand } from '../../types/appTypes';
import { DEFAULT_AI_COMMANDS, DEFAULT_PERSONAS } from '../../stores/settingsStore';
import { DEFAULT_WHITELIST, DEFAULT_BLACKLIST } from '../../utils/commandLists';

export function AISettingsTab() {
  const settings = useSettingsStore();
  const update = settings.update;

  const [showGeminiWarning, setShowGeminiWarning] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [activePersonaId, setActivePersonaId] = useState(settings.aiPersonas[0]?.id ?? '');
  const [newWhitelistEntry, setNewWhitelistEntry] = useState('');
  const [newBlacklistEntry, setNewBlacklistEntry] = useState('');
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

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

  const updatePersonaCommands = (personaId: string, commands: AskAiCommand[]) => {
    updatePersona(personaId, { askAiCommands: commands });
  };

  const handleDragStart = (index: number) => {
    setDraggedIndex(index);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (dropIndex: number) => {
    if (draggedIndex === null || draggedIndex === dropIndex) return;
    const cmds = [...(activePersona?.askAiCommands || [])];
    const [moved] = cmds.splice(draggedIndex, 1);
    cmds.splice(dropIndex, 0, moved);
    updatePersonaCommands(activeTabId, cmds);
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  return (
    <>
      {/* -- AI Provider -- */}
      <div className="settings-card">
      <h3 className="settings-section-title settings-section-title--first">Provider</h3>
      <div className="settings-group">
        <label>
          AI Provider
          <HelpTooltip text="Vertex AI and Gemini use Google OAuth. Anthropic and OpenAI require API keys." />
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
          <option value="vertexai">Google Cloud Vertex AI</option>
          <option value="gemini">Google AI Studio (Gemini)</option>
          <option value="anthropic">Anthropic (Claude)</option>
          <option value="openai">OpenAI</option>
        </select>
      </div>

      {/* -- Authentication -- */}
      <div className="settings-group" style={{ marginBottom: '15px' }}>
        <label>Authentication</label>
        <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{
              width: '10px',
              height: '10px',
              borderRadius: '50%',
              backgroundColor: isAuthenticated ? 'var(--success-color)' : 'var(--color-danger)'
            }} />
            <span>{isAuthenticated ? 'Authenticated' : 'Not Authenticated'}</span>
          </div>
          {isAuthenticated && (
            <button
              className="settings-button"
              onClick={() => setShowLogoutConfirm(true)}
            >
              Logout
            </button>
          )}
        </div>
      </div>

      </div>

      {/* -- Personas -- */}
      <div className="settings-card">
      <h3 className="settings-section-title">Personas</h3>
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
              label: 'New Persona',
              systemPrompt: 'You are a helpful assistant.',
              askAiCommands: [...DEFAULT_AI_COMMANDS],
            };
            update('aiPersonas', [...personas, newPersona]);
            setActivePersonaId(id);
          }}
          title="Add Persona"
        >
          +
        </button>
      </div>

      {/* -- Active Persona Content -- */}
      {activePersona && (
        <div className="ai-settings-persona-content">
          {/* Persona Name */}
          <div className="settings-group">
            <label>Persona Name</label>
            <input
              type="text"
              value={activePersona.label}
              onChange={(e) => updatePersona(activeTabId, { label: e.target.value })}
              placeholder="Display Name"
            />
          </div>

          {/* System Prompt */}
          <div className="settings-group">
            <label>System Prompt</label>
            <textarea
              value={activePersona.systemPrompt}
              onChange={(e) => updatePersona(activeTabId, { systemPrompt: e.target.value })}
              placeholder="System Prompt"
              className="ai-settings-textarea"
              rows={3}
            />
          </div>

          {/* Ask AI Commands */}
          <div className="settings-group">
            <label>Ask AI Commands</label>
            <div className="ai-settings-command-list">
              {activePersona.askAiCommands?.map((cmd, index) => (
                <div
                  key={cmd.id}
                  draggable
                  onDragStart={() => handleDragStart(index)}
                  onDragOver={(e) => { handleDragOver(e); setDragOverIndex(index); }}
                  onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverIndex(null); }}
                  onDrop={() => { handleDrop(index); }}
                  onDragEnd={handleDragEnd}
                  className="ai-settings-command-card"
                  style={{
                    borderColor: dragOverIndex === index && draggedIndex !== null && draggedIndex !== index ? 'var(--accent-color)' : undefined,
                    opacity: draggedIndex === index ? 0.5 : 1,
                  }}
                >
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <span className="ai-settings-drag-handle" title="Drag to reorder">&#9776;</span>
                    <input
                      type="text"
                      value={cmd.label}
                      onChange={(e) => {
                        const newCommands = [...activePersona.askAiCommands];
                        newCommands[index] = { ...cmd, label: e.target.value };
                        updatePersonaCommands(activeTabId, newCommands);
                      }}
                      placeholder="Label"
                      style={{ flex: 1 }}
                    />
                    <button
                      className="ai-settings-delete-btn"
                      onClick={() => {
                        const newCommands = activePersona.askAiCommands.filter((_, i) => i !== index);
                        updatePersonaCommands(activeTabId, newCommands);
                      }}
                    >
                      &#10005;
                    </button>
                  </div>
                  <textarea
                    value={cmd.promptTemplate}
                    onChange={(e) => {
                      const newCommands = [...activePersona.askAiCommands];
                      newCommands[index] = { ...cmd, promptTemplate: e.target.value };
                      updatePersonaCommands(activeTabId, newCommands);
                    }}
                    placeholder="Prompt Template ({selection} will be replaced)"
                    className="ai-settings-textarea"
                    rows={2}
                  />
                  <HelpTooltip text={`Use {selection} placeholder for the selected text.`} />
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
              <button
                className="settings-button"
                onClick={() => {
                  const id = crypto.randomUUID();
                  const newCommand: AskAiCommand = { id, label: 'New Command', promptTemplate: '{selection}' };
                  updatePersonaCommands(activeTabId, [...(activePersona.askAiCommands || []), newCommand]);
                }}
              >
                + Add Command
              </button>
              <button
                className="settings-button"
                onClick={() => {
                  updatePersonaCommands(activeTabId, [...DEFAULT_AI_COMMANDS]);
                }}
              >
                Reset Commands
              </button>
            </div>
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
              title={personas.length <= 1 ? 'At least one persona is required' : `Delete "${activePersona.label}"`}
            >
              Delete Persona
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
          Reset All Personas
        </button>
      </div>

      </div>

      {/* -- Command Execution -- */}
      <div className="settings-card">
      <h3 className="settings-section-title">Command Execution</h3>
      <p className="settings-help-text" style={{ marginBottom: '10px' }}>
        Execution mode and the auto-run limit are configured in the AI Chat pane (below the message input).
      </p>

      {/* Command safety classifier */}
      <div className="settings-group">
        <label>
          Command Safety Classifier
          <HelpTooltip text="How HoTTY decides whether an AI-suggested command is auto-executed. The Blacklist is always checked first (a match asks before executing). Static: Whitelist auto-runs, everything else asks. AI: the AI judges anything not blacklisted. Hybrid (recommended): Whitelist auto-runs, the AI judges the rest, otherwise ask." />
        </label>
        <select
          value={settings.classifierStrategy}
          onChange={(e) => update('classifierStrategy', e.target.value as typeof settings.classifierStrategy)}
        >
          <option value="static">Static whitelist</option>
          <option value="ai">AI judgment</option>
          <option value="hybrid">Hybrid (recommended)</option>
        </select>
      </div>

      {/* AI confidence threshold (only relevant when AI judges commands) */}
      {settings.classifierStrategy !== 'static' && (
        <div className="settings-group">
          <label>
            AI Confidence Threshold: {Math.round(settings.aiClassifyConfidenceThreshold * 100)}%
            <HelpTooltip text="Minimum AI confidence required to auto-execute a command judged read-only. Below this, the command waits for a manual Run. Higher = more cautious. Default: 70%." />
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
          Device Response Timeout (seconds)
          <HelpTooltip text="If the device produces no new output for this many seconds after a command, the AI is told the device stopped responding so the loop can continue. 0 disables idle detection. Default: 10." />
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

      {/* Whitelist — auto-execute */}
      <div className="settings-group">
        <label>
          Whitelist (auto-execute)
          <HelpTooltip text="Commands matched here auto-execute. A single word matches as a base command (e.g. 'docker' matches any docker command); an entry with spaces matches as a substring (e.g. 'git log'). Seeded with safe defaults; fully editable." />
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
            placeholder="e.g., docker, kubectl get"
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
            Add
          </button>
          <button
            className="settings-button"
            onClick={() => update('whitelistCommands', [...DEFAULT_WHITELIST])}
            title="Reset the whitelist to the built-in defaults"
          >
            Reset to defaults
          </button>
        </div>
        {settings.whitelistCommands.length > 0 && (
          <div className="ai-settings-tag-list">
            {settings.whitelistCommands.map((cmd) => (
              <span key={cmd} className="ai-settings-tag">
                {cmd}
                <button
                  onClick={() => update('whitelistCommands', settings.whitelistCommands.filter(c => c !== cmd))}
                  title={`Remove ${cmd}`}
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
          Blacklist (ask before execute)
          <HelpTooltip text="Commands matched here are never auto-executed — a manual Run is still allowed, with a warning. A single word matches as a base command; an entry with spaces matches as a substring (e.g. 'rm -rf', 'git push'). Seeded with destructive defaults; fully editable." />
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
            placeholder="e.g., rm -rf, git push"
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
            Add
          </button>
          <button
            className="settings-button"
            onClick={() => update('blacklistCommands', [...DEFAULT_BLACKLIST])}
            title="Reset the blacklist to the built-in defaults"
          >
            Reset to defaults
          </button>
        </div>
        {settings.blacklistCommands.length > 0 && (
          <div className="ai-settings-tag-list">
            {settings.blacklistCommands.map((cmd) => (
              <span key={cmd} className="ai-settings-tag">
                {cmd}
                <button
                  onClick={() => update('blacklistCommands', settings.blacklistCommands.filter(c => c !== cmd))}
                  title={`Remove ${cmd}`}
                >
                  &#10005;
                </button>
              </span>
            ))}
          </div>
        )}
      </div>
      </div>

      {/* -- Modals -- */}
      {showGeminiWarning && (
        <ConfirmModal
          title="Privacy Notice"
          message="Google AI Studio (Gemini) may use your data for AI training on the free tier. Enable billing on your Google Cloud project to opt out."
          confirmLabel="OK"
          onConfirm={() => setShowGeminiWarning(false)}
          onCancel={() => setShowGeminiWarning(false)}
        />
      )}
      {showLogoutConfirm && (
        <ConfirmModal
          title="Logout"
          message="Are you sure you want to logout? You will need to re-authenticate to use the AI provider."
          confirmLabel="Logout"
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

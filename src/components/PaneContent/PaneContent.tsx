import React from 'react';
import { TerminalComponent } from '../Terminal/Terminal';
import { AIChatPane } from '../AIChatPane/AIChatPane';
import { LogViewerPane } from '../LogViewerPane/LogViewerPane';
import { PingMonitorPane } from '../PingMonitorPane/PingMonitorPane';
import { TextEditorPane } from '../TextEditorPane/TextEditorPane';
import type { TextEditorPaneHandle } from '../TextEditorPane/TextEditorPane';
import { FileExplorerPane } from '../FileExplorerPane/FileExplorerPane';
import type { Session } from '../../hooks/useSessionManager';
import type { InteractiveSessionTracking } from '../../hooks/useInteractiveFlow';
import type { Terminal } from '@xterm/xterm';
import { useSettingsStore } from '../../stores/settingsStore';
import { useShallow } from 'zustand/react/shallow';

// -- Types --

interface PaneContentProps {
  session: Session;
  isActive: boolean;
  focusTrigger: number;
  disableFocus: boolean;

  // Terminal props
  terminalInstance: Terminal | undefined;
  onData: (sessionId: string, data: string) => void;
  onPasteRequest: (text: string) => void;

  // AI Chat props
  lastTerminalSessionId?: string | null;
  lastTerminalSessionTitle?: string | null;
  interactiveSessionTracking?: InteractiveSessionTracking;
  onRunCommand?: (targetId: string, command: string) => void;
  onShowPromptMenu?: () => void;
  onSendMessage?: (text: string) => void;
  onStateChange?: (newState: Partial<Session['aiChatState']>) => void;
  onPingMonitorStateChange?: (newState: Partial<NonNullable<Session['pingMonitorState']>>) => void;
  onTextEditorStateChange?: (newState: Partial<NonNullable<Session['textEditorState']>>) => void;
  onFileExplorerStateChange?: (newState: Partial<NonNullable<Session['fileExplorerState']>>) => void;
  onFileExplorerOpenFile?: (filePath: string) => void;
  textEditorRegistry?: React.MutableRefObject<{ [sessionId: string]: TextEditorPaneHandle }>;
}

// -- Component --

export const PaneContent: React.FC<PaneContentProps> = React.memo(({
  session,
  isActive,
  focusTrigger,
  disableFocus,
  // Terminal
  terminalInstance,
  onData,
  onPasteRequest,
  // AI Chat
  lastTerminalSessionId,
  lastTerminalSessionTitle,
  interactiveSessionTracking,
  onRunCommand,
  onShowPromptMenu,
  onSendMessage,
  onStateChange,
  onPingMonitorStateChange,
  onTextEditorStateChange,
  onFileExplorerStateChange,
  onFileExplorerOpenFile,
  textEditorRegistry,
}) => {
  const {
    fontSize,
    fontFamily,
    terminalForeground,
    terminalBackground,
    terminalBackgroundInactive,
    lineWrapEnabled,
    enablePromptHighlight,
    promptHighlightColor,
    promptPatterns,
    showSystemPrompt,
    aiPersonas,
    activePersonaId,
  } = useSettingsStore(useShallow(s => ({
    fontSize: s.fontSize,
    fontFamily: s.fontFamily,
    terminalForeground: s.terminalForeground,
    terminalBackground: s.terminalBackground,
    terminalBackgroundInactive: s.terminalBackgroundInactive,
    lineWrapEnabled: s.lineWrapEnabled,
    enablePromptHighlight: s.enablePromptHighlight,
    promptHighlightColor: s.promptHighlightColor,
    promptPatterns: s.promptPatterns,
    showSystemPrompt: s.showSystemPrompt,
    aiPersonas: s.aiPersonas,
    activePersonaId: s.activePersonaId,
  })));

  const askAiCommands = React.useMemo(() => {
    const persona = aiPersonas.find(p => p.id === activePersonaId);
    return persona?.askAiCommands ?? aiPersonas[0]?.askAiCommands ?? [];
  }, [aiPersonas, activePersonaId]);

  if (session.type === 'file-explorer') {
    return (
      <FileExplorerPane
        sessionId={session.id}
        initialState={session.fileExplorerState}
        onStateChange={onFileExplorerStateChange}
        onOpenFile={onFileExplorerOpenFile}
      />
    );
  }

  if (session.type === 'text-editor') {
    return (
      <TextEditorPane
        sessionId={session.id}
        initialState={session.textEditorState}
        onStateChange={onTextEditorStateChange}
        registry={textEditorRegistry}
      />
    );
  }

  if (session.type === 'ping-monitor') {
    return (
      <PingMonitorPane
        sessionId={session.id}
        initialState={session.pingMonitorState}
        onStateChange={onPingMonitorStateChange}
      />
    );
  }

  if (session.type === 'log-viewer') {
    return (
      <LogViewerPane
        loggingPath={session.logViewerState?.loggingPath || ''}
        askAiCommands={askAiCommands}
      />
    );
  }

  if (session.type === 'ai') {
    return (
      <AIChatPane
        sessionId={session.id}
        initialState={session.aiChatState}
        onStateChange={onStateChange ? (newState) => onStateChange(newState) : undefined}
        showSystemPrompt={showSystemPrompt}
        askAiCommands={askAiCommands}
        aiPersonas={aiPersonas}
        fontSize={fontSize}
        terminalBackground={terminalBackground}
        terminalBackgroundInactive={terminalBackgroundInactive}
        lastTerminalSessionId={lastTerminalSessionId}
        lastTerminalSessionTitle={lastTerminalSessionTitle}
        onShowPromptMenu={onShowPromptMenu}
        onSendMessage={onSendMessage}
        interactiveSessionTracking={interactiveSessionTracking}
        onRunCommand={onRunCommand}
      />
    );
  }

  return (
    <TerminalComponent
      key={session.id}
      sessionId={session.id}
      onData={onData}
      isActive={isActive}
      focusTrigger={focusTrigger}
      terminalInstance={terminalInstance}
      disableFocus={disableFocus}
      fontSize={fontSize}
      fontFamily={fontFamily}
      terminalForeground={terminalForeground}
      terminalBackground={terminalBackground}
      terminalBackgroundInactive={terminalBackgroundInactive}
      lineWrapEnabled={lineWrapEnabled}
      askAiCommands={askAiCommands}
      enablePromptHighlight={enablePromptHighlight}
      promptHighlightColor={promptHighlightColor}
      promptPatterns={promptPatterns}
      onPasteRequest={onPasteRequest}
    />
  );
});

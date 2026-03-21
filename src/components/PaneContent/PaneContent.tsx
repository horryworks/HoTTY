import React from 'react';
import { TerminalComponent } from '../Terminal/Terminal';
import { AIChatPane } from '../AIChatPane/AIChatPane';
import { LogViewerPane } from '../LogViewerPane/LogViewerPane';
import { PingMonitorPane } from '../PingMonitorPane/PingMonitorPane';
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
    askAiCommands,
    showSystemPrompt,
    aiPersonas,
    proactiveInstruction,
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
    askAiCommands: s.askAiCommands,
    showSystemPrompt: s.showSystemPrompt,
    aiPersonas: s.aiPersonas,
    proactiveInstruction: s.proactiveInstruction,
  })));

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
        proactiveInstruction={proactiveInstruction}
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

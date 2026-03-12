import React from 'react';
import { TerminalComponent } from '../Terminal/Terminal';
import { AIChatPane } from '../AIChatPane/AIChatPane';
import type { Session } from '../../hooks/useSessionManager';
import type { InteractiveSessionTracking } from '../../hooks/useInteractiveFlow';
import { useTerminalSettings } from '../../contexts/TerminalSettingsContext';

// -- Types --

interface PaneContentProps {
  session: Session;
  isActive: boolean;
  focusTrigger: number;
  disableFocus: boolean;

  // Terminal props
  terminalInstance: any;
  onData: (sessionId: string, data: string) => void;
  onPasteRequest: (text: string) => void;

  // AI Chat props
  lastTerminalSessionId?: string | null;
  lastTerminalSessionTitle?: string | null;
  interactiveSessionTracking?: InteractiveSessionTracking;
  onRunCommand?: (targetId: string, command: string) => void;
  onShowPromptMenu?: () => void;
  onSendMessage?: (text: string) => void;
  onStateChange?: (newState: any) => void;
}

// -- Component --

export const PaneContent: React.FC<PaneContentProps> = ({
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
    askGeminiCommands,
    showSystemPrompt,
    aiPersonas,
    proactiveInstruction,
  } = useTerminalSettings();

  if (session.type === 'ai') {
    return (
      <AIChatPane
        sessionId={session.id}
        initialState={session.aiChatState}
        onStateChange={onStateChange ? (newState) => onStateChange(newState) : undefined}
        showSystemPrompt={showSystemPrompt}
        askGeminiCommands={askGeminiCommands}
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
      askGeminiCommands={askGeminiCommands}
      enablePromptHighlight={enablePromptHighlight}
      promptHighlightColor={promptHighlightColor}
      promptPatterns={promptPatterns}
      onPasteRequest={onPasteRequest}
    />
  );
};

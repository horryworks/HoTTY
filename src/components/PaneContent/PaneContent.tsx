import React from 'react';
import { TerminalComponent } from '../Terminal/Terminal';
import { AIChatPane } from '../AIChatPane/AIChatPane';
import type { Session } from '../../hooks/useSessionManager';
import type { PromptPattern } from '../../hooks/useInteractiveFlow';
import type { InteractiveSessionTracking } from '../../hooks/useInteractiveFlow';

// -- Types --

interface PaneContentProps {
  session: Session;
  isActive: boolean;
  focusTrigger: number;
  disableFocus: boolean;

  // Terminal props
  terminalInstance: any;
  onData: (sessionId: string, data: string) => void;
  fontSize: number;
  fontFamily: string;
  terminalForeground: string;
  terminalBackground: string;
  terminalBackgroundInactive?: string;
  lineWrapEnabled: boolean;
  askGeminiCommands: { id: string; label: string; promptTemplate: string }[];
  enablePromptHighlight?: boolean;
  promptHighlightColor?: string;
  promptPatterns?: PromptPattern[];
  onPasteRequest: (text: string) => void;

  // AI Chat props
  showSystemPrompt: boolean;
  aiPersonas: { id: string; label: string; systemPrompt: string }[];
  lastTerminalSessionId?: string | null;
  lastTerminalSessionTitle?: string | null;
  proactiveInstruction?: string;
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
  fontSize,
  fontFamily,
  terminalForeground,
  terminalBackground,
  terminalBackgroundInactive,
  lineWrapEnabled,
  askGeminiCommands,
  enablePromptHighlight,
  promptHighlightColor,
  promptPatterns,
  onPasteRequest,
  // AI Chat
  showSystemPrompt,
  aiPersonas,
  lastTerminalSessionId,
  lastTerminalSessionTitle,
  proactiveInstruction,
  interactiveSessionTracking,
  onRunCommand,
  onShowPromptMenu,
  onSendMessage,
  onStateChange,
}) => {
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

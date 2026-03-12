import React, { createContext, useContext } from 'react';
import type { PromptPattern } from '../App';
import type { AskGeminiCommand, PersonaDefinition } from '../App';

export interface TerminalSettings {
  fontSize: number;
  fontFamily: string;
  terminalForeground: string;
  terminalBackground: string;
  terminalBackgroundInactive: string;
  lineWrapEnabled: boolean;
  enablePromptHighlight: boolean;
  promptHighlightColor: string;
  promptPatterns: PromptPattern[];
  askGeminiCommands: AskGeminiCommand[];
  showSystemPrompt: boolean;
  aiPersonas: PersonaDefinition[];
  proactiveInstruction: string;
}

const TerminalSettingsContext = createContext<TerminalSettings | null>(null);

export const TerminalSettingsProvider: React.FC<{ value: TerminalSettings; children: React.ReactNode }> = ({ value, children }) => {
  return (
    <TerminalSettingsContext.Provider value={value}>
      {children}
    </TerminalSettingsContext.Provider>
  );
};

export function useTerminalSettings(): TerminalSettings {
  const ctx = useContext(TerminalSettingsContext);
  if (!ctx) throw new Error('useTerminalSettings must be used inside TerminalSettingsProvider');
  return ctx;
}

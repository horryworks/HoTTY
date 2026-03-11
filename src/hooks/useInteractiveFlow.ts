import { useState, useEffect, useRef, useCallback } from 'react';

// -- Types --

export interface PromptPattern {
  id: string;
  name: string;
  pattern: string;
  enabled: boolean;
}

export interface InteractiveSessionTracking {
  aiSessionId: string;
  buffer: string;
  originalCommand: string;
  startTime: number;
}

interface UseInteractiveFlowOptions {
  promptPatterns: PromptPattern[];
  onFeedbackReady: (aiSessionId: string, resultText: string, termSessionId: string) => void;
}

interface UseInteractiveFlowReturn {
  trackings: Record<string, InteractiveSessionTracking>;
  startTracking: (termSessionId: string, aiSessionId: string, command: string) => void;
  cancelTracking: (termSessionId: string) => void;
  sendNow: (termSessionId: string) => void;
}

// -- Hook --

export function useInteractiveFlow(options: UseInteractiveFlowOptions): UseInteractiveFlowReturn {
  const { promptPatterns, onFeedbackReady } = options;

  const [trackings, setTrackings] = useState<Record<string, InteractiveSessionTracking>>({});
  const trackingsRef = useRef(trackings);
  useEffect(() => { trackingsRef.current = trackings; }, [trackings]);

  const onFeedbackReadyRef = useRef(onFeedbackReady);
  useEffect(() => { onFeedbackReadyRef.current = onFeedbackReady; }, [onFeedbackReady]);

  const stabilizationTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // -- Cleanup helper --
  const removeTracking = useCallback((sessionId: string) => {
    if (stabilizationTimersRef.current[sessionId]) {
      clearTimeout(stabilizationTimersRef.current[sessionId]);
      delete stabilizationTimersRef.current[sessionId];
    }
    setTrackings(prev => {
      const next = { ...prev };
      delete next[sessionId];
      return next;
    });
    delete trackingsRef.current[sessionId];
  }, []);

  // -- Public API --

  const startTracking = useCallback((termSessionId: string, aiSessionId: string, command: string) => {
    const newTracking: InteractiveSessionTracking = {
      aiSessionId,
      buffer: '',
      originalCommand: command,
      startTime: Date.now()
    };
    setTrackings(prev => ({ ...prev, [termSessionId]: newTracking }));
    trackingsRef.current[termSessionId] = newTracking;
  }, []);

  const cancelTracking = useCallback((termSessionId: string) => {
    if (trackingsRef.current[termSessionId]) {
      window.electronAPI.logDebug(`[Interactive Flow] Tracking cancelled for session ${termSessionId}`);
      removeTracking(termSessionId);
    }
  }, [removeTracking]);

  const sendNow = useCallback((termSessionId: string) => {
    const currentTracking = trackingsRef.current[termSessionId];
    if (!currentTracking) return;

    window.electronAPI.logDebug(`[Interactive Flow] Manual send triggered for session ${termSessionId}`);

    const resultText = `Terminal Output (Manual Send - Command: ${currentTracking.originalCommand}):\n\`\`\`\n${currentTracking.buffer}\n\`\`\``;
    const aiSessionId = currentTracking.aiSessionId;

    removeTracking(termSessionId);
    onFeedbackReadyRef.current(aiSessionId, resultText, termSessionId);
  }, [removeTracking]);

  // -- Terminal data listener for prompt detection --
  useEffect(() => {
    const removeListener = window.electronAPI.onSessionData((sessionId, data) => {
      const currentTracking = trackingsRef.current[sessionId];
      if (!currentTracking) return;

      // Strip ANSI/OSC sequences
      const cleanData = data
        .replace(/\x1b][^\x07\x1b]*(\x07|\x1b\\)/g, '')
        .replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '')
        .replace(/\r\n/g, '\n').replace(/\r/g, '\n');

      if (!cleanData.replace(/\n/g, '')) return;

      const newBuffer = currentTracking.buffer + cleanData;
      currentTracking.buffer = newBuffer;

      setTrackings(prev => ({
        ...prev,
        [sessionId]: { ...prev[sessionId], buffer: newBuffer }
      }));

      // Check for prompt at end of buffer
      const lines = newBuffer.split('\n');
      const lastLine = lines[lines.length - 1];

      if (lastLine.trim().length > 0) {
        let matched = false;
        let matchedPatternName = '';
        for (const patternObj of promptPatterns) {
          if (!patternObj.enabled || !patternObj.pattern) continue;
          try {
            const regex = new RegExp(patternObj.pattern);
            const trimmedLine = lastLine.trimLeft();
            const match = regex.exec(trimmedLine);
            if (match && match.index === 0) {
              matched = true;
              matchedPatternName = patternObj.name;
              break;
            }
          } catch { /* ignore */ }
        }

        if (matched) {
          window.electronAPI.logDebug(
            `[Interactive Flow] Prompt matched (${matchedPatternName}): "${lastLine.trim()}" in session ${sessionId}. Finalizing soon...`
          );

          if (stabilizationTimersRef.current[sessionId]) {
            clearTimeout(stabilizationTimersRef.current[sessionId]);
          }

          stabilizationTimersRef.current[sessionId] = setTimeout(() => {
            window.electronAPI.logDebug(`[Interactive Flow] Prompt confirmed for session ${sessionId}. Finalizing output.`);

            const finalTracking = trackingsRef.current[sessionId];
            delete stabilizationTimersRef.current[sessionId];
            if (!finalTracking) return;

            const resultText = `Terminal Output (Command: ${finalTracking.originalCommand}):\n\`\`\`\n${finalTracking.buffer}\n\`\`\``;
            const aiSessionId = finalTracking.aiSessionId;

            // Remove tracking before callback to prevent race conditions
            setTrackings(prev => {
              const next = { ...prev };
              delete next[sessionId];
              return next;
            });
            delete trackingsRef.current[sessionId];

            onFeedbackReadyRef.current(aiSessionId, resultText, sessionId);
          }, 100);
        }
      }
    });

    return () => {
      removeListener();
      Object.values(stabilizationTimersRef.current).forEach(clearTimeout);
      stabilizationTimersRef.current = {};
    };
  }, [promptPatterns]);

  // -- TTL Cleanup (every minute) --
  useEffect(() => {
    const ttlInterval = setInterval(() => {
      const now = Date.now();
      const MAX_TTL = 15 * 60 * 1000;

      setTrackings(prev => {
        let changed = false;
        const next = { ...prev };

        Object.keys(next).forEach(sid => {
          if (now - next[sid].startTime > MAX_TTL) {
            window.electronAPI.logDebug(`[Interactive Flow] Cleaning up stale session ${sid} (TTL exceeded)`);
            if (stabilizationTimersRef.current[sid]) {
              clearTimeout(stabilizationTimersRef.current[sid]);
              delete stabilizationTimersRef.current[sid];
            }
            delete next[sid];
            delete trackingsRef.current[sid];
            changed = true;
          }
        });

        return changed ? next : prev;
      });
    }, 60 * 1000);

    return () => clearInterval(ttlInterval);
  }, []);

  return {
    trackings,
    startTracking,
    cancelTracking,
    sendNow,
  };
}

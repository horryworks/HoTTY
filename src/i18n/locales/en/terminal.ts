// Terminal chrome — accessibility labels for the marker rail (prompt / output
// block markers) and the custom scrollbar rail. The xterm host itself renders
// no app-level text. English is the source of truth.
export const terminal = {
  scrollbar: 'Terminal scrollbar',
  markerRail: 'Prompt markers',
  promptMarker: 'Jump to prompt',
  outputMarker: 'Select output block',
  askAiInputTitle: 'Ask AI',
  askAiInputPlaceholder: 'Ask AI about the selection… (Enter to send)',
} as const;

// ?7  = DECAWM autowrap (soft-wrap long lines at the right edge).
// ?45 = reverse-wraparound: makes a backspace (0x08) at column 0 of a
//       soft-wrapped line climb to the END of the previous line instead of
//       sticking at column 0. Network devices (Huawei VRP, Cisco) emit a bare
//       0x08 to move the cursor left across a wrap boundary while editing a long
//       command and assume the terminal wraps the cursor back — real xterm and
//       PuTTY do. xterm.js defaults ?45 OFF, so without this you can't backspace
//       past the start of a continuation line. Paired with ?7 because it only
//       has any effect on soft-wrapped lines. Local terminal modes only; never
//       sent to the device.
export const TERMINAL_SEQUENCES = {
  LINE_WRAP_ENABLED: '\x1b[?7h\x1b[?45h',
  LINE_WRAP_DISABLED: '\x1b[?7l\x1b[?45l',
} as const;

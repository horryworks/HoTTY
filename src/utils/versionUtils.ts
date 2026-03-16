export function isNewerVersion(latest: string, current: string): boolean {
  const parsePart = (s: string): [number, string | null] => {
    const idx = s.indexOf('-');
    if (idx === -1) return [parseInt(s, 10) || 0, null];
    return [parseInt(s.slice(0, idx), 10) || 0, s.slice(idx + 1)];
  };
  const parsePre = (pre: string | null): number => {
    if (pre === null) return Infinity; // stable release is greater than any pre-release
    const m = pre.match(/(\d+)$/);
    return m ? parseInt(m[1], 10) : 0;
  };
  const parse = (v: string) => {
    const parts = v.split('.');
    const [maj] = parsePart(parts[0] ?? '0');
    const [min] = parsePart(parts[1] ?? '0');
    const [patch, pre] = parsePart(parts[2] ?? '0');
    return { maj, min, patch, pre };
  };
  const l = parse(latest);
  const c = parse(current);
  if (l.maj !== c.maj) return l.maj > c.maj;
  if (l.min !== c.min) return l.min > c.min;
  if (l.patch !== c.patch) return l.patch > c.patch;
  return parsePre(l.pre) > parsePre(c.pre);
}

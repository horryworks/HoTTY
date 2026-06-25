import { describe, it, expect } from 'vitest';
import type { LocaleCatalog } from './types';

// `types.ts` is type-only; these tests exercise the `LocaleCatalog<T>` contract by
// constructing values (compile-checked by tsc) and asserting their runtime shape.
// If the type ever regresses (e.g. keys become required, or plural extras are
// disallowed), `tsc -b` fails on these literals.
describe('LocaleCatalog', () => {
  type Source = {
    common: { save: 'Save'; cancel: 'Cancel' };
    panes: { count_one: '{{count}} item'; count_other: '{{count}} items' };
  };

  it('accepts a partial catalog (omitted keys fall back to English at runtime)', () => {
    const partial: LocaleCatalog<Source> = { common: { save: '保存' } };
    expect(partial.common?.save).toBe('保存');
    expect(partial.common?.cancel).toBeUndefined();
    expect(partial.panes).toBeUndefined();
  });

  it('widens literal leaves to string so translations may differ from English', () => {
    const full: LocaleCatalog<Source> = {
      common: { save: 'Guardar', cancel: 'Cancelar' },
      panes: { count_one: '{{count}} elemento', count_other: '{{count}} elementos' },
    };
    expect(full.common?.save).toBe('Guardar');
    expect(full.panes?.count_other).toContain('{{count}}');
  });

  it('permits extra CLDR plural categories (e.g. Russian _few/_many)', () => {
    const ru: LocaleCatalog<Source> = {
      panes: {
        count_one: '{{count}} элемент',
        count_few: '{{count}} элемента',
        count_many: '{{count}} элементов',
        count_other: '{{count}} элементов',
      },
    };
    const panes = ru.panes as Record<string, string>;
    expect(panes.count_few).toBe('{{count}} элемента');
    expect(panes.count_many).toBe('{{count}} элементов');
  });
});

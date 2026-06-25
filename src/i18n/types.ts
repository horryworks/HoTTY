// Shared helper types for the i18n catalogs.

/** Extra CLDR plural-category keys some languages need that English does not.
 *  English (and most en-shaped keys) only carry `_one`/`_other`; languages like
 *  Russian also need `_few`/`_many` (and a few use `_zero`/`_two`). These template
 *  index signatures let a locale add those plural variants for any key without
 *  breaking the structural check — while still flagging genuine typos (a stray key
 *  that doesn't end in one of these four suffixes and isn't in English errors out). */
type CldrPluralExtras = {
  readonly [k: `${string}_zero`]: string;
  readonly [k: `${string}_two`]: string;
  readonly [k: `${string}_few`]: string;
  readonly [k: `${string}_many`]: string;
};

/** A translated catalog shaped like the English source `T`: the same nested key
 *  structure (validated at compile time), every leaf widened from its literal to
 *  `string` (translations differ from English), and every key optional so a locale
 *  can omit not-yet-translated keys and fall back to English at runtime. Each object
 *  level also accepts the extra CLDR plural-category keys above. */
export type LocaleCatalog<T> = {
  [K in keyof T]?: T[K] extends string ? string : LocaleCatalog<T[K]>;
} & CldrPluralExtras;

const MAX_SLUG_LENGTH = 48
// Combining marks left behind by NFKD normalization (e.g. the combining
// acute accent NFKD splits "\u00e9" into) -- a Unicode property escape, not a
// from-to character class, so it can't be read as "a character and a
// combining character" (biome's noMisleadingCharacterClass).
const COMBINING_MARKS = /\p{M}/gu

export function slugify(title: string): string {
  const slug = title
    .normalize('NFKD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, '')
  return slug.length > 0 ? slug : 'untitled'
}

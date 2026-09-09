import { describe, expect, it } from 'vitest'
import { slugify } from './slug.js'

describe('slugify', () => {
  it('lowercases and hyphenates', () => {
    expect(slugify('Add dark mode toggle')).toBe('add-dark-mode-toggle')
  })
  it('strips punctuation and collapses runs of non-alnum characters', () => {
    expect(slugify('Fix the /api/news 500 error!!')).toBe(
      'fix-the-api-news-500-error',
    )
  })
  it('strips diacritics', () => {
    expect(slugify('Résumé import')).toBe('resume-import')
  })
  it('trims leading/trailing hyphens', () => {
    expect(slugify('  --already hyphenated--  ')).toBe('already-hyphenated')
  })
  it('truncates long titles to 48 characters without a trailing hyphen', () => {
    const slug = slugify(`${'a'.repeat(40)} ${'b'.repeat(40)}`)
    expect(slug.length).toBeLessThanOrEqual(48)
    expect(slug.endsWith('-')).toBe(false)
  })
  it('falls back to "untitled" for a title with no alphanumeric characters', () => {
    expect(slugify('!!!')).toBe('untitled')
  })
})

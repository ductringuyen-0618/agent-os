import { describe, expect, it } from 'vitest'
import {
  CONTEXT_WINDOWS,
  DEFAULT_CONTEXT_WINDOW,
  contextWindowFor,
} from './model.js'

describe('contextWindowFor', () => {
  it('returns the documented window for known model ids', () => {
    expect(contextWindowFor('claude-sonnet-5')).toBe(
      CONTEXT_WINDOWS['claude-sonnet-5'],
    )
    expect(contextWindowFor('sonnet')).toBe(CONTEXT_WINDOWS.sonnet)
  })

  it('returns the larger window for a [1m] long-context variant', () => {
    expect(contextWindowFor('claude-sonnet-5[1m]')).toBe(1_000_000)
  })

  it('falls back to the default window for an unrecognized model id', () => {
    expect(contextWindowFor('some-future-model')).toBe(DEFAULT_CONTEXT_WINDOW)
  })
})

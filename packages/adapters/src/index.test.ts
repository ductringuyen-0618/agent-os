import { describe, expect, it } from 'vitest'
import { adapterRegistry } from './index.js'

describe('adapterRegistry', () => {
  it('registers techpulse-coo', () => {
    expect(adapterRegistry['techpulse-coo']).toBeDefined()
    expect(adapterRegistry['techpulse-coo'].name).toBe('techpulse-coo')
    expect(typeof adapterRegistry['techpulse-coo'].sync).toBe('function')
    expect(typeof adapterRegistry['techpulse-coo'].applyDecision).toBe(
      'function',
    )
  })
})

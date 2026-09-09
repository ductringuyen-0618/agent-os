import { describe, expect, it } from 'vitest'
import type { FeatureRequestInput } from './workflow.js'

describe('FeatureRequestInput', () => {
  it('accepts the spec §5.1 shape', () => {
    const input: FeatureRequestInput = {
      project: 'techpulse',
      title: 'Add dark mode toggle',
      description: 'Users keep asking for it.',
      autoApprove: true,
    }
    expect(input.project).toBe('techpulse')
    expect(input.title).toBe('Add dark mode toggle')
    expect(input.autoApprove).toBe(true)
  })
})

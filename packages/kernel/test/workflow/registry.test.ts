import { describe, expect, it } from 'vitest'
import { WorkflowRegistry } from '../../src/workflow/registry.js'
import type { WorkflowDefinition } from '../../src/workflow/types.js'

const fakeDef: WorkflowDefinition<{ title: string }> = {
  kind: 'fake',
  async run(ctx) {
    ctx.state.done = true
  },
}

describe('WorkflowRegistry', () => {
  it('registers and looks up a definition by kind', () => {
    const registry = new WorkflowRegistry()
    registry.register(fakeDef)
    expect(registry.get('fake')).toBe(fakeDef)
    expect(registry.list()).toEqual(['fake'])
  })
  it('rejects a duplicate kind', () => {
    const registry = new WorkflowRegistry()
    registry.register(fakeDef)
    expect(() => registry.register(fakeDef)).toThrow(/already registered/)
  })
  it('get returns undefined for an unknown kind', () => {
    const registry = new WorkflowRegistry()
    expect(registry.get('nope')).toBeUndefined()
  })
})

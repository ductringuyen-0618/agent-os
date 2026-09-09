// packages/kernel/src/syscall/tools.test.ts
import { describe, expect, it } from 'vitest'
import { SyscallToolDefs } from './tools.js'

describe('SyscallToolDefs', () => {
  it('defines exactly the 8 contract §6 tools', () => {
    expect(Object.keys(SyscallToolDefs).sort()).toEqual(
      [
        'emit_event',
        'get_context',
        'read_inbox',
        'read_wiki',
        'remember',
        'request_approval',
        'schedule',
        'send_message',
      ].sort(),
    )
  })
  it('every tool has a non-empty description and an mcpInputSchema', () => {
    for (const def of Object.values(SyscallToolDefs)) {
      expect(def.description.length).toBeGreaterThan(0)
      expect(def.mcpInputSchema).toMatchObject({ type: 'object' })
    }
  })
  it('remember requires page and content', () => {
    expect(() => SyscallToolDefs.remember.inputSchema.parse({})).toThrow()
    expect(
      SyscallToolDefs.remember.inputSchema.parse({
        page: 'a.md',
        content: 'x',
      }),
    ).toEqual({ page: 'a.md', content: 'x' })
  })
  it('emit_event accepts an optional payload', () => {
    expect(
      SyscallToolDefs.emit_event.inputSchema.parse({ type: 'custom.foo' }),
    ).toMatchObject({ type: 'custom.foo' })
  })
})

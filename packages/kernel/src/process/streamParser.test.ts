import { describe, expect, it } from 'vitest'
import { parseStreamLine } from './streamParser.js'

describe('parseStreamLine', () => {
  it('returns null for blank lines', () => {
    expect(parseStreamLine('')).toBeNull()
    expect(parseStreamLine('   \n')).toBeNull()
  })

  it('returns null for unparseable JSON', () => {
    expect(parseStreamLine('not json')).toBeNull()
  })

  it('parses a system init message', () => {
    const msg = parseStreamLine(
      '{"type":"system","subtype":"init","session_id":"s1","model":"sonnet"}',
    )
    expect(msg).toEqual({
      type: 'system',
      subtype: 'init',
      session_id: 's1',
      model: 'sonnet',
    })
  })

  it('parses an assistant message with a tool_use block', () => {
    const line =
      '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read","input":{"file_path":"x"}}]},"session_id":"s1"}'
    const msg = parseStreamLine(line)
    expect(msg?.type).toBe('assistant')
  })

  it('parses a result message', () => {
    const msg = parseStreamLine(
      '{"type":"result","subtype":"success","session_id":"s1","total_cost_usd":0.01}',
    )
    expect(msg?.type).toBe('result')
  })
})

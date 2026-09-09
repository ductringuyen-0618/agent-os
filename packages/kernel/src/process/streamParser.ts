import type { ClaudeStreamMessage } from '@agentos/shared'

export function parseStreamLine(line: string): ClaudeStreamMessage | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  try {
    const parsed = JSON.parse(trimmed)
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof parsed.type !== 'string'
    )
      return null
    return parsed as ClaudeStreamMessage
  } catch {
    return null
  }
}

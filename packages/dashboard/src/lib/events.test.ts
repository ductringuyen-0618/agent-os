import type { Event } from '@agentos/shared'
import { describe, expect, it } from 'vitest'
import {
  classifyEvent,
  describeEvent,
  feedItemsFromHistory,
  mergeFeed,
} from './events'

function ev(type: Event['type'], payload = {}, runId?: string): Event {
  return { id: 1, ts: '2026-09-09T12:00:00Z', type, payload, runId }
}

describe('classifyEvent', () => {
  it('reserves "human" for decisions and "alert" for failures', () => {
    expect(classifyEvent('decision.created')).toBe('human')
    expect(classifyEvent('run.failed')).toBe('alert')
    expect(classifyEvent('ops.alert')).toBe('alert')
    expect(classifyEvent('run.started')).toBe('run')
    expect(classifyEvent('git.push')).toBe('git')
    expect(classifyEvent('wiki.written')).toBe('memory')
    expect(classifyEvent('custom.thing')).toBe('memory')
  })
})

describe('describeEvent', () => {
  it('writes one plain sentence per event', () => {
    expect(describeEvent(ev('run.started', { routine: 'heartbeat' }))).toBe(
      'heartbeat started',
    )
    expect(describeEvent(ev('run.started', {}, 'run_abcdef123'))).toBe(
      'run run_abcd started',
    )
    expect(
      describeEvent(ev('decision.created', { title: 'Ship dark mode' })),
    ).toBe('Waiting on you: Ship dark mode')
    expect(describeEvent(ev('git.push', { branch: 'main' }))).toBe(
      'Pushed to main',
    )
    expect(describeEvent(ev('run.failed', { error: 'exit 1' }))).toBe(
      'a run failed: exit 1',
    )
  })
})

describe('feedItemsFromHistory + mergeFeed', () => {
  it('seeds from runs and decisions, newest first, de-duplicated', () => {
    const items = feedItemsFromHistory(
      [
        {
          id: 'r1',
          routine: 'ingest',
          status: 'failed',
          attempt: 1,
          startedAt: '2026-09-09T10:00:00Z',
          endedAt: '2026-09-09T10:05:00Z',
        },
      ],
      [
        {
          id: 'd1',
          title: 'Approve X',
          body: '',
          status: 'approved',
          createdAt: '2026-09-09T11:00:00Z',
          resolvedAt: '2026-09-09T11:30:00Z',
        },
      ],
    )
    const merged = mergeFeed(items, items)
    expect(merged.map((i) => i.text)).toEqual([
      'You approved Approve X',
      'Waiting on you: Approve X',
      'ingest failed',
      'ingest started',
    ])
    expect(merged.find((i) => i.text === 'ingest failed')?.kind).toBe('alert')
  })
})

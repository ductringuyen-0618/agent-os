import { describe, expect, it } from 'vitest'
import {
  DecisionSchema,
  EvalCriteriaSchema,
  EventSchema,
  MessageSchema,
  ProjectConfigSchema,
  RoutineConfigSchema,
  RoutinesFileSchema,
  RunSchema,
  WorkflowSchema,
  WorkflowStepSchema,
  parseRoutinesFile,
} from './schemas.js'

describe('RunSchema', () => {
  it('accepts a minimal run', () => {
    expect(() =>
      RunSchema.parse({
        id: 'r1',
        routine: 'heartbeat',
        status: 'queued',
        attempt: 1,
      }),
    ).not.toThrow()
  })
  it('rejects an unknown status', () => {
    expect(() =>
      RunSchema.parse({
        id: 'r1',
        routine: 'heartbeat',
        status: 'nope',
        attempt: 1,
      }),
    ).toThrow()
  })
})

describe('EventSchema', () => {
  it('accepts a built-in event type', () => {
    expect(() =>
      EventSchema.parse({
        id: 1,
        ts: '2026-09-08T00:00:00.000Z',
        type: 'run.started',
        payload: {},
      }),
    ).not.toThrow()
  })
  it('accepts a custom.* event type', () => {
    expect(() =>
      EventSchema.parse({
        id: 1,
        ts: '2026-09-08T00:00:00.000Z',
        type: 'custom.my-thing',
        payload: {},
      }),
    ).not.toThrow()
  })
  it('rejects an event type that is neither built-in nor custom.*', () => {
    expect(() =>
      EventSchema.parse({
        id: 1,
        ts: '2026-09-08T00:00:00.000Z',
        type: 'bogus.event',
        payload: {},
      }),
    ).toThrow()
  })
})

describe('DecisionSchema / MessageSchema / ProjectConfigSchema / EvalCriteriaSchema', () => {
  it('accept valid shapes', () => {
    expect(() =>
      DecisionSchema.parse({
        id: 'd1',
        title: 't',
        body: 'b',
        status: 'pending',
        createdAt: '2026-09-08T00:00:00.000Z',
      }),
    ).not.toThrow()
    expect(() =>
      MessageSchema.parse({
        id: 'm1',
        from: 'ops',
        to: 'librarian',
        body: 'hi',
        ts: '2026-09-08T00:00:00.000Z',
      }),
    ).not.toThrow()
    expect(() =>
      ProjectConfigSchema.parse({
        name: 'techpulse',
        adapter: 'techpulse-coo',
        repo: 'x',
        clone: 'y',
        base_branch: 'main',
        options: {},
      }),
    ).not.toThrow()
    expect(() =>
      EvalCriteriaSchema.parse({
        criteria: [{ key: 'accuracy', weight: 1, description: 'd' }],
      }),
    ).not.toThrow()
  })
})

describe('RoutineConfigSchema', () => {
  it('accepts a routine with exactly one trigger', () => {
    expect(() =>
      RoutineConfigSchema.parse({ name: 'heartbeat', every: '30m' }),
    ).not.toThrow()
  })
  it('accepts a manual-only routine with no trigger', () => {
    expect(() =>
      RoutineConfigSchema.parse({ name: 'daily-digest' }),
    ).not.toThrow()
  })
  it('rejects a routine with two triggers set', () => {
    expect(() =>
      RoutineConfigSchema.parse({
        name: 'bad',
        every: '30m',
        cron: '0 3 * * *',
      }),
    ).toThrow()
  })
})

describe('parseRoutinesFile', () => {
  const yamlText = `
defaults:
  model: sonnet
  permission_mode: plan
  allowed_tools: [Read, Glob, Grep, WebFetch, WebSearch]
  max_attempts: 2
  timeout_ms: 300000
routines:
  - name: heartbeat
    every: 30m
    skill: heartbeat
    agent: ops
    model: haiku
`
  it('parses valid YAML into a RoutinesFile', () => {
    const parsed = parseRoutinesFile(yamlText)
    expect(parsed.defaults.model).toBe('sonnet')
    expect(parsed.routines).toHaveLength(1)
    expect(parsed.routines[0].name).toBe('heartbeat')
  })
  it('throws a ZodError on invalid YAML', () => {
    expect(() =>
      parseRoutinesFile('defaults: {}\nroutines: "not-an-array"'),
    ).toThrow()
  })
})

describe('RoutinesFileSchema', () => {
  it('is used by parseRoutinesFile and is independently importable', () => {
    expect(RoutinesFileSchema).toBeDefined()
  })
})

describe('EventTypeSchema workflow.* events', () => {
  it('accepts a workflow.* event type', () => {
    expect(() =>
      EventSchema.parse({
        id: 1,
        ts: new Date().toISOString(),
        type: 'workflow.step.started',
        payload: {},
      }),
    ).not.toThrow()
  })
})

describe('WorkflowSchema', () => {
  const base = {
    id: 'wf1',
    kind: 'feature-request',
    title: 'Add dark mode',
    input: {},
    state: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  it('accepts a minimal queued workflow instance', () => {
    expect(() =>
      WorkflowSchema.parse({ ...base, status: 'queued' }),
    ).not.toThrow()
  })
  it('rejects an unknown status', () => {
    expect(() => WorkflowSchema.parse({ ...base, status: 'nope' })).toThrow()
  })
})

describe('WorkflowStepSchema', () => {
  it('accepts a minimal succeeded step', () => {
    expect(() =>
      WorkflowStepSchema.parse({
        id: 's1',
        workflowId: 'wf1',
        name: 'brief',
        seq: 1,
        status: 'succeeded',
        attempt: 1,
        startedAt: new Date().toISOString(),
      }),
    ).not.toThrow()
  })
})

describe('RoutinesFileSchema workflows block', () => {
  const yaml = (extra: string) =>
    `defaults:\n  model: sonnet\n  permission_mode: plan\n  allowed_tools: []\n  max_attempts: 2\n  timeout_ms: 1000\nroutines: []\n${extra}`

  it('accepts an optional workflows.max_concurrent', () => {
    const file = parseRoutinesFile(yaml('workflows:\n  max_concurrent: 3\n'))
    expect(file.workflows?.max_concurrent).toBe(3)
  })
  it('is optional -- an absent workflows block parses fine', () => {
    const file = parseRoutinesFile(yaml(''))
    expect(file.workflows).toBeUndefined()
  })
})

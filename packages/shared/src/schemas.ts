import { parse as parseYaml } from 'yaml'
import { z } from 'zod'
import type { RoutinesFile } from './types/routine.js'

const BUILTIN_EVENT_TYPES = [
  'run.queued',
  'run.started',
  'run.stream',
  'run.wrapup',
  'run.finished',
  'run.failed',
  'run.killed',
  'raw.added',
  'raw.changed',
  'proposal.changed',
  'decision.created',
  'decision.resolved',
  'message.sent',
  'wiki.written',
  'schedule.created',
  'git.commit',
  'git.push',
  'ops.alert',
  'security.redacted',
] as const

export const EventTypeSchema = z.union([
  z.enum(BUILTIN_EVENT_TYPES),
  z
    .string()
    .regex(
      /^(custom|workflow)\..+$/,
      'custom/workflow event types must start with "custom." or "workflow."',
    ),
])

export const RunStatusSchema = z.enum([
  'queued',
  'running',
  'wrapping_up',
  'success',
  'failed',
  'blocked',
  'killed',
])

export const RunSchema = z.object({
  id: z.string(),
  routine: z.string(),
  skill: z.string().optional(),
  adapter: z.string().optional(),
  agent: z.string().optional(),
  status: RunStatusSchema,
  attempt: z.number().int(),
  payload: z.record(z.unknown()).optional(),
  sessionId: z.string().optional(),
  pid: z.number().optional(),
  startedAt: z.string().optional(),
  endedAt: z.string().optional(),
  inputTokens: z.number().optional(),
  outputTokens: z.number().optional(),
  costUsd: z.number().optional(),
  error: z.string().optional(),
})

export const EventSchema = z.object({
  id: z.number(),
  ts: z.string(),
  type: EventTypeSchema,
  runId: z.string().optional(),
  payload: z.record(z.unknown()),
})

export const DecisionStatusSchema = z.enum([
  'pending',
  'approved',
  'rejected',
  'error',
])

export const DecisionSchema = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string(),
  adapter: z.string().optional(),
  ref: z.string().optional(),
  status: DecisionStatusSchema,
  createdByRun: z.string().optional(),
  createdAt: z.string(),
  resolvedAt: z.string().optional(),
  error: z.string().optional(),
})

export const MessageSchema = z.object({
  id: z.string(),
  from: z.string(),
  to: z.string(),
  body: z.string(),
  ts: z.string(),
  readAt: z.string().optional(),
})

export const PermissionModeSchema = z.enum([
  'plan',
  'acceptEdits',
  'default',
  'bypassPermissions',
])

export const RoutineDefaultsSchema = z.object({
  model: z.string(),
  permission_mode: PermissionModeSchema,
  allowed_tools: z.array(z.string()),
  max_attempts: z.number().int(),
  timeout_ms: z.number().int(),
})

export const RoutineConfigSchema = z
  .object({
    name: z.string(),
    enabled: z.boolean().optional(),
    skill: z.string().optional(),
    adapter: z.string().optional(),
    agent: z.string().optional(),
    every: z.string().optional(),
    cron: z.string().optional(),
    on: z.array(EventTypeSchema).optional(),
    after: z.array(z.string()).optional(),
    model: z.string().optional(),
    permission_mode: PermissionModeSchema.optional(),
    allowed_tools: z.array(z.string()).optional(),
    extra_mcp: z
      .record(
        z.object({
          command: z.string(),
          args: z.array(z.string()).optional(),
          env: z.record(z.string()).optional(),
        }),
      )
      .optional(),
    max_attempts: z.number().int().optional(),
    timeout_ms: z.number().int().optional(),
  })
  .refine(
    (r) => [r.every, r.cron, r.on].filter((v) => v !== undefined).length <= 1,
    { message: 'at most one of every|cron|on may be set on a routine' },
  )

export const WorkflowStatusSchema = z.enum([
  'queued',
  'running',
  'waiting',
  'sleeping',
  'paused',
  'succeeded',
  'failed',
  'terminated',
])

export const WorkflowSchema = z.object({
  id: z.string(),
  kind: z.string(),
  status: WorkflowStatusSchema,
  project: z.string().optional(),
  title: z.string(),
  input: z.record(z.unknown()),
  state: z.record(z.unknown()),
  currentStep: z.string().optional(),
  wakeAt: z.string().optional(),
  waitEvent: z.string().optional(),
  error: z.string().optional(),
  createdAt: z.string(),
  startedAt: z.string().optional(),
  endedAt: z.string().optional(),
  updatedAt: z.string(),
})

export const WorkflowStepStatusSchema = z.enum([
  'running',
  'succeeded',
  'failed',
  'skipped',
  'waiting',
  'sleeping',
])

export const WorkflowStepSchema = z.object({
  id: z.string(),
  workflowId: z.string(),
  name: z.string(),
  seq: z.number().int(),
  status: WorkflowStepStatusSchema,
  attempt: z.number().int(),
  runId: z.string().optional(),
  output: z.unknown().optional(),
  error: z.string().optional(),
  startedAt: z.string(),
  endedAt: z.string().optional(),
})

export const WorkflowsConfigSchema = z.object({
  max_concurrent: z.number().int().positive(),
})

export const RoutinesFileSchema = z.object({
  defaults: RoutineDefaultsSchema,
  routines: z.array(RoutineConfigSchema),
  workflows: WorkflowsConfigSchema.optional(),
})

export const ProjectBuildConfigSchema = z.object({
  enabled: z.boolean(),
  model: z.string(),
  permission_mode: PermissionModeSchema,
  allowed_tools: z.array(z.string()),
  checks: z.array(z.string()),
  timeout_ms: z.number().int(),
})

export const ProjectConfigSchema = z.object({
  name: z.string(),
  adapter: z.string(),
  repo: z.string(),
  clone: z.string(),
  base_branch: z.string(),
  options: z.record(z.unknown()),
  build: ProjectBuildConfigSchema.optional(),
})

export const EvalCriteriaSchema = z.object({
  criteria: z.array(
    z.object({ key: z.string(), weight: z.number(), description: z.string() }),
  ),
})

export function parseRoutinesFile(yamlText: string): RoutinesFile {
  const obj = parseYaml(yamlText)
  // RoutinesFileSchema's zod-inferred type widens EventTypeSchema (a union of an
  // enum and a regex-matched string) to `string`, so it doesn't structurally match
  // the hand-written `RoutinesFile`/`EventType` types from ./types/routine.js
  // (which uses the `custom.${string}` template literal). The runtime validation
  // is identical either way; this assertion just reconciles the two type sources.
  return RoutinesFileSchema.parse(obj) as RoutinesFile
}

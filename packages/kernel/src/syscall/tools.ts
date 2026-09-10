// packages/kernel/src/syscall/tools.ts
import { z } from 'zod'

export interface SyscallToolDef {
  description: string
  inputSchema: z.ZodTypeAny
  mcpInputSchema: Record<string, unknown>
}

export const SyscallToolDefs = {
  get_context: {
    description:
      'Return business-brain.md and the current wiki index.md so the agent has situational context before doing anything else.',
    inputSchema: z.object({}),
    mcpInputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  remember: {
    description:
      'Write or update a wiki page. Enforces frontmatter, upserts index.md, appends log.md. Refuses secrets and paths under raw/.',
    inputSchema: z.object({
      page: z.string().min(1),
      content: z.string().min(1),
      links: z.array(z.string()).optional(),
      op: z.enum(['ingest', 'query', 'lint', 'decision', 'note']).optional(),
    }),
    mcpInputSchema: {
      type: 'object',
      properties: {
        page: { type: 'string' },
        content: { type: 'string' },
        links: { type: 'array', items: { type: 'string' } },
        op: {
          type: 'string',
          enum: ['ingest', 'query', 'lint', 'decision', 'note'],
        },
      },
      required: ['page', 'content'],
      additionalProperties: false,
    },
  },
  read_wiki: {
    description: 'Read one wiki page by path, relative to wiki/.',
    inputSchema: z.object({ page: z.string().min(1) }),
    mcpInputSchema: {
      type: 'object',
      properties: { page: { type: 'string' } },
      required: ['page'],
      additionalProperties: false,
    },
  },
  emit_event: {
    description:
      'Append a custom event to the run log. "type" must be "raw.added" or start with "custom.".',
    inputSchema: z.object({
      type: z.string().min(1),
      payload: z.record(z.unknown()).optional(),
    }),
    mcpInputSchema: {
      type: 'object',
      properties: { type: { type: 'string' }, payload: { type: 'object' } },
      required: ['type'],
      additionalProperties: false,
    },
  },
  send_message: {
    description: 'Send an agent-to-agent mailbox message.',
    inputSchema: z.object({ to: z.string().min(1), body: z.string().min(1) }),
    mcpInputSchema: {
      type: 'object',
      properties: { to: { type: 'string' }, body: { type: 'string' } },
      required: ['to', 'body'],
      additionalProperties: false,
    },
  },
  read_inbox: {
    description: "Read (and mark read) this agent's inbox messages.",
    inputSchema: z.object({}),
    mcpInputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  schedule: {
    description:
      'Schedule a one-shot future run of a skill. "when" is an ISO datetime or a relative offset like "+30m" / "+2h".',
    inputSchema: z.object({
      skill: z.string().min(1),
      when: z.string().min(1),
      payload: z.record(z.unknown()).optional(),
    }),
    mcpInputSchema: {
      type: 'object',
      properties: {
        skill: { type: 'string' },
        when: { type: 'string' },
        payload: { type: 'object' },
      },
      required: ['skill', 'when'],
      additionalProperties: false,
    },
  },
  request_approval: {
    description:
      'Create a pending Decision for a human to approve or reject from the dashboard/CLI. Never resolves it.',
    inputSchema: z.object({
      title: z.string().min(1),
      body: z.string().min(1),
      adapter: z.string().optional(),
      ref: z.string().optional(),
    }),
    mcpInputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        body: { type: 'string' },
        adapter: { type: 'string' },
        ref: { type: 'string' },
      },
      required: ['title', 'body'],
      additionalProperties: false,
    },
  },
  propose_feature: {
    description:
      'Start a feature request for a project that waits for a human decision (never auto-approved). Refused while the project already has a pending decision or an unfinished request: one idea in flight per project.',
    inputSchema: z.object({
      project: z.string().min(1),
      title: z.string().min(3).max(120),
      description: z.string().min(40),
    }),
    mcpInputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string' },
        title: { type: 'string' },
        description: { type: 'string' },
      },
      required: ['project', 'title', 'description'],
      additionalProperties: false,
    },
  },
} as const satisfies Record<string, SyscallToolDef>

export type SyscallToolName = keyof typeof SyscallToolDefs

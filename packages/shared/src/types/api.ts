// M1 subset only (health + runs routes). Later milestones append more
// entries here for decisions/routines/wiki/skills/agents/costs/projects/
// syscall as their routes land — see "Contract additions" in
// docs/superpowers/plans/2026-09-08-agent-os-m1-kernel-core.md.
import type { RunStatus } from "./run.js";

export interface HealthResponse {
  ok: true;
  version: string;
}

export interface ErrorResponse {
  error: string;
}

export interface ListRunsQuery {
  status?: RunStatus;
  routine?: string;
  limit?: number;
}

export interface ListRunEventsQuery {
  sinceId?: number;
}

export interface CreateRunRequest {
  skill: string;
  agent?: string;
  payload?: Record<string, unknown>;
}

export interface CreateRunResponse {
  runId: string;
}

export interface KillRunResponse {
  ok: boolean;
}

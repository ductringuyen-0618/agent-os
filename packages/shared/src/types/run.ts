export type RunStatus =
  | "queued"
  | "running"
  | "wrapping_up"
  | "success"
  | "failed"
  | "blocked"
  | "killed";

export interface Run {
  id: string;
  routine: string;
  skill?: string;
  adapter?: string;
  agent?: string;
  status: RunStatus;
  attempt: number;
  payload?: Record<string, unknown>;
  sessionId?: string;
  pid?: number;
  startedAt?: string;
  endedAt?: string;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  error?: string;
}

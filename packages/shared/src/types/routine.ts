import type { EventType } from "./event.js";

export type PermissionMode =
  | "plan"
  | "acceptEdits"
  | "default"
  | "bypassPermissions";

export interface RoutineDefaults {
  model: string;
  permission_mode: PermissionMode;
  allowed_tools: string[];
  max_attempts: number;
  timeout_ms: number;
}

export interface RoutineConfig {
  name: string;
  enabled?: boolean;
  skill?: string;
  adapter?: string;
  agent?: string;
  every?: string;
  cron?: string;
  on?: EventType[];
  after?: string[];
  model?: string;
  permission_mode?: PermissionMode;
  allowed_tools?: string[];
  extra_mcp?: Record<
    string,
    { command: string; args?: string[]; env?: Record<string, string> }
  >;
  max_attempts?: number;
  timeout_ms?: number;
}

export interface RoutinesFile {
  defaults: RoutineDefaults;
  routines: RoutineConfig[];
}

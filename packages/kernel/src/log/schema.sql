CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, routine TEXT NOT NULL, skill TEXT, adapter TEXT, agent TEXT,
  status TEXT NOT NULL, attempt INTEGER NOT NULL DEFAULT 1, payload TEXT, session_id TEXT, pid INTEGER,
  started_at TEXT, ended_at TEXT, input_tokens INTEGER, output_tokens INTEGER, cost_usd REAL, error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, type TEXT NOT NULL,
  run_id TEXT, payload TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS events_run ON events(run_id); CREATE INDEX IF NOT EXISTS events_type ON events(type);
CREATE TABLE IF NOT EXISTS decisions (id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL, adapter TEXT, ref TEXT,
  status TEXT NOT NULL, created_by_run TEXT, created_at TEXT NOT NULL, resolved_at TEXT, error TEXT, project TEXT);
CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, from_agent TEXT NOT NULL, to_agent TEXT NOT NULL, body TEXT NOT NULL,
  ts TEXT NOT NULL, read_at TEXT);
CREATE TABLE IF NOT EXISTS schedules (id TEXT PRIMARY KEY, skill TEXT NOT NULL, when_at TEXT NOT NULL, payload TEXT, fired_at TEXT);
CREATE TABLE IF NOT EXISTS run_tokens (run_id TEXT PRIMARY KEY, token TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS workflows (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, status TEXT NOT NULL,
  project TEXT, title TEXT NOT NULL, input TEXT NOT NULL, state TEXT NOT NULL,
  current_step TEXT, wake_at TEXT, wait_event TEXT, error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  started_at TEXT, ended_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
CREATE INDEX IF NOT EXISTS workflows_status ON workflows(status);
CREATE INDEX IF NOT EXISTS workflows_kind ON workflows(kind);
CREATE TABLE IF NOT EXISTS workflow_steps (
  id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL, name TEXT NOT NULL, seq INTEGER NOT NULL,
  status TEXT NOT NULL, attempt INTEGER NOT NULL DEFAULT 1, run_id TEXT, output TEXT, error TEXT,
  started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), ended_at TEXT);
CREATE INDEX IF NOT EXISTS workflow_steps_workflow ON workflow_steps(workflow_id);

---
description: Writes the day's digest page from what changed in the wiki, once lint has passed.
---
# daily-digest

Runs daily at 08:00 as agent `ops`, `permission_mode: acceptEdits`, gated by
`after: [lint]` (only runs if `lint` last ran successfully today).

## Input payload
```json
{
  "wikiLog": "## [2026-09-08] ingest | ...\n...",
  "runsLast24h": [
    { "id": "run-9", "routine": "ingest", "status": "success", "startedAt": "...", "endedAt": "...", "costUsd": 0.01 }
  ]
}
```
`wikiLog` is `WikiService.readLog(200)`. `runsLast24h` is
`EventLog.listRuns()` filtered by the kernel to runs whose `startedAt` falls
in the last 24 hours.

## Steps
1. Summarize `wikiLog` and `runsLast24h` into a short markdown digest: counts
   by routine/status, notable wiki changes, and a mention of any recent
   `ops.alert` (read `agents/ops.md` via `mcp__agentos__read_wiki` for
   detail — the payload does not filter alerts in for you).
2. Write the digest directly to `output/digests/<YYYY-MM-DD>.md` using the
   `Write` tool — **not** `remember`. `output/` is a deliverable directory,
   not the wiki, and is unreachable through any syscall. This works because
   every run already gets `--add-dir <os-root>` (spec §4.2) and
   `permission_mode: acceptEdits` allows the write.
3. Call `mcp__agentos__remember` with `page: "projects/digests.md"`,
   `op: "note"`, linking to today's digest path, so the wiki index/log
   record that a digest exists.

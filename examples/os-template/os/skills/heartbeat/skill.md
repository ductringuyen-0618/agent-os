---
description: Cheap, frequent pulse-check across the OS: stale routines, failed runs, pending decisions.
---
# heartbeat

Cheap, frequent pulse-check across the OS. Runs every 30 minutes as agent `ops` on model `haiku`.

## Input payload
The kernel injects a JSON task payload with exactly this shape (see `kernel.ts`'s
`exec` callback, the `routine.skill === 'heartbeat'` branch):
```json
{
  "unindexedRaw": ["raw/techpulse/proposals/003-slug.md"],
  "routineStatus": [
    {
      "name": "ingest",
      "enabled": true,
      "nextRun": "2026-09-08T13:00:00.000Z",
      "lastRun": { "status": "success", "endedAt": "2026-09-08T12:30:00.000Z" }
    }
  ]
}
```
`unindexedRaw` is `WikiService.listUnindexedRaw()`. `routineStatus` is
`Scheduler.list()`, reduced to `{ name, enabled, nextRun, lastRun }` (`lastRun`
is `null` if the routine has never run).

## Steps
1. For each path in `unindexedRaw`, call `mcp__agentos__emit_event` with
   `{ "type": "raw.added", "payload": { "path": "<path>" } }`. This is the
   only path by which new raw files get indexed — the `ingest` routine
   listens for `raw.added`.
2. For each entry in `routineStatus`: if `lastRun` is `null` while `nextRun`
   is in the past, or `lastRun.status === "failed"`, write a short note via
   `mcp__agentos__remember` to page `agents/ops.md` (title includes the
   routine name and timestamp). Do **not** call `emit_event` for this —
   `emit_event` only accepts `raw.added` or `custom.*`; `ops.alert` is
   reserved for the kernel itself, which independently detects and emits it
   from the scheduler's tick (failed run after retries exhausted, or an
   `every`-routine that missed its interval).
3. If no entry named `lint` has a `lastRun.endedAt` within the last 24 hours,
   call `mcp__agentos__schedule` with `{ "skill": "lint", "when": "+1m" }`.
4. Call `mcp__agentos__remember` once more with `page: "agents/ops.md"`,
   `op: "note"`, summarizing counts (e.g. "3 raw files indexed, 1 alert
   noted, lint not scheduled").
5. Stop. Never call `request_approval`, never touch `raw/`.

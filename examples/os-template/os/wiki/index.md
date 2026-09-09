# Wiki Index

One line per page. Maintained by `WikiService.writePage` (the `remember`
syscall) — do not hand-edit the list below except to fix a `lint` finding.

## Pages
- (none yet — this is a fresh instance; the `heartbeat`, `ingest`, `lint`,
  and `daily-digest` routines populate `agents/`, `projects/`,
  `concepts/`, and `decisions/` as they run)

## Directory guide
- `wiki/agents/` — one page per agent: recent activity, alerts raised by
  `heartbeat`
- `wiki/projects/` — one page per project, including `sources/` pages
  written by `ingest` and a `proposals/`-derived trail once an adapter
  like `techpulse-coo` is syncing
- `wiki/concepts/` — durable facts and definitions that don't belong to a
  single project
- `wiki/decisions/` — one page per resolved `Decision`, linked from its
  project page
- `wiki/digests/` — daily digests written by the `daily-digest` skill

---
status: proposed
attempts: 0
branch: null
---
# `agentos skill new` and `agentos skill validate`

## What you get
Writing a new skill today means hand-copying another skill's five files and
guessing at the shape of `eval.json`. A new `agentos skill new <name>` command
scaffolds `skills/<name>/{skill.md, eval.json, learnings.md, last-output.md,
context/handoff.md}` with a correct, minimal template in one step. A
companion `agentos skill validate [name]` statically checks every skill (or
one) for the mistakes that currently fail silently: missing files, an
`eval.json` whose criteria weights don't sum to 1, a skill nothing in
`routines.yaml` references (dead weight, never runs), and a routine that
references a skill directory that doesn't exist (will fail the moment it
fires). Both commands run instantly, offline, with no daemon and no model
call.

## Why start this now
agent-os's whole self-improvement loop — the wrap-up turn scoring a run
against `eval.json`, the Skills panel trending that score — depends on
`eval.json` being well-formed, and nothing today checks that before a run
burns a `claude -p` invocation to find out. Anthropic's own Agent Skills
guidance stresses that a skill's frontmatter and structure are what makes it
discoverable and reliable at all ("Equipping agents for the real world with
Agent Skills", claude.com) — exactly the shape `skills/<name>/skill.md`
already follows here — and separately, 2026 research on agentic skill-use
(SkillCoach, arXiv:2607.01874) makes the case that skill quality has to be
checked as a distinct signal from task outcome, because broken or
overlapping skills fail in ways a single successful run won't surface. Right
now the only way to discover a skill is misconfigured is to watch it run,
fail the wrap-up scoring, or just never fire because no routine points at it
— all costing real money and surfacing only after the fact. A five-minute,
zero-dependency CLI check catches all of that before the first `claude -p`
call, and makes starting a new skill a one-command action instead of a
copy-paste ritual.

## Problem / opportunity
`packages/cli/src/commands/` has one command per daemon-facing verb (`ps`,
`logs`, `run`, `routines`, `sync`, ...) but nothing for the skill-authoring
loop itself. `examples/os-template/os/skills/<name>/` shows the expected
shape (`skill.md` frontmatter + body, `eval.json` with a `criteria` array of
`{key, weight, description}`, `learnings.md`, `last-output.md`,
`context/handoff.md`) but it exists only as copy-paste material. Nothing
checks that an `eval.json`'s weights sum to 1, that a skill directory is
referenced by at least one `routines.yaml` entry, or that a routine's
`skill:` field actually resolves to a directory — `packages/shared/src/
schemas.ts` already has `RoutineConfigSchema` for the latter check but
nothing in the CLI calls it against the filesystem.

## Proposed solution
- `packages/cli/src/commands/skill.ts` (new): two subcommands under
  `agentos skill`.
  - `new <name> [--agent <agent>]`: writes the five files under
    `os/skills/<name>/` using the same minimal shape as
    `examples/os-template/os/skills/heartbeat/` (frontmatter `description:`,
    a `## Steps` stub in `skill.md`; one `criteria` entry in `eval.json`
    with `weight: 1`; a bootstrap line in `learnings.md`; empty
    `last-output.md` and `context/handoff.md`). Refuses to overwrite an
    existing skill directory.
  - `validate [name]`: reads `os/skills/` (or just `skills/<name>/` if
    given) and `os/routines.yaml`, parsed with the existing
    `RoutineConfigSchema` from `packages/shared`, and reports, per skill:
    missing required files, an `eval.json` whose `criteria[].weight` don't
    sum to `1 ± 0.001`, duplicate `criteria[].key` values, and whether any
    routine's `skill:` matches it (orphan skill warning). Separately
    reports any routine whose `skill:` matches no directory under
    `os/skills/` (dangling reference, flagged as an error, not just a
    warning). Exits non-zero if any error-level finding exists; warnings
    print but don't fail the command.
- `packages/cli/src/bin.ts`: register `agentos skill new` and
  `agentos skill validate` the same way existing commands are wired in.
- No kernel, dashboard, or schema changes — this is CLI-only, reading
  `routines.yaml` and `skills/` from disk the way `init` already does.

## Effort estimate
S — two new CLI subcommands, a static template, and a pure filesystem
check reusing an existing Zod schema. No new dependency, no daemon
involvement, no schema migration.

## Validation contract
- Functional assertions:
  - `agentos skill new foo` creates `os/skills/foo/{skill.md, eval.json,
    learnings.md, last-output.md, context/handoff.md}`; re-running it
    against the same name exits non-zero and writes nothing.
  - `agentos skill validate` against a skill whose `eval.json` weights sum
    to `0.9` reports an error naming that skill and that file.
  - `agentos skill validate` against a skill directory with no matching
    `skill:` in any `routines.yaml` entry reports an orphan warning naming
    the skill.
  - `agentos skill validate` against a `routines.yaml` entry whose `skill:`
    matches no directory under `skills/` reports a dangling-reference error
    naming the routine.
  - A fully well-formed skill + routines.yaml pair validates clean with no
    findings and exit code 0.
- Behavioral assertions:
  - `agentos skill validate` runs with no running daemon and makes no HTTP
    call — purely reads the filesystem, like `agentos init`.
  - Running `validate` on the real `examples/os-template/os/` tree (checked
    into this repo) finds zero errors, proving the template itself stays
    valid.
- Negative assertions (should NOT happen):
  - `skill new` never overwrites an existing file or directory.
  - `skill validate` never starts a `claude -p` process, never calls the
    daemon's HTTP/WebSocket API, and never modifies any file under `os/`.
  - A warning-level finding (orphan skill) never changes the command's exit
    code; only error-level findings (malformed eval.json weights, dangling
    routine reference, missing required file) do.
- Test commands the build will need to pass (from `.github/workflows/`):
  - `pnpm install --frozen-lockfile`
  - `pnpm lint`
  - `pnpm build`
  - `pnpm -r run typecheck`
  - `pnpm test`

## Risks / open questions
- Whether `validate`'s orphan-skill check should also look at adapter-driven
  skills that aren't named in `routines.yaml` at all (ad-hoc skills run only
  via `agentos run <skill>` or `schedule()`) — these are legitimate and
  should not be flagged as errors, only possibly omitted from the orphan
  check entirely; worth confirming against `Scheduler.resolveAdhocRoutine`'s
  behavior before deciding the exact wording.
- Whether `skill new`'s template should also offer to append a stub entry
  to `routines.yaml`, or stay strictly scoped to the `skills/` directory and
  leave wiring it up to the human — the proposal assumes the latter, to
  keep the change small and because `routines.yaml` edits are easy to get
  wrong by a scripted append.

## Sources consulted
- "Equipping agents for the real world with Agent Skills" (claude.com/blog)
  — SKILL.md frontmatter/structure conventions this proposal's `skill new`
  template follows.
- SkillCoach: Self-Evolving Rubrics for Evaluating and Enhancing Agentic
  Skill-Use (arXiv:2607.01874) — motivates checking skill quality as a
  signal distinct from run outcome, which `skill validate` does statically
  and cheaply instead of via rollouts.

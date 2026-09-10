# Security model

This describes what an agent-os agent can and cannot touch, and where the
actual security boundaries live. It applies to both the public template
and any private instance built from it.

## What an agent can do
- Read `os/CLAUDE.md`, its own `agents/<name>/AGENT.md`, its skill's
  `skill.md`/`learnings.md`/`context/handoff.md`, and — subject to the
  routine's `allowed_tools` — read files under the `os/` root (`raw/`,
  `wiki/`) via `Read`/`Glob`/`Grep`, and browse the web via
  `WebFetch`/`WebSearch` if those tools are allowed for that routine.
- Call the eight `agentos` syscalls (`get_context`, `remember`,
  `read_wiki`, `emit_event`, `send_message`, `read_inbox`, `schedule`,
  `request_approval`) — these are the *only* way to durably change
  anything outside its own workspace.
- Write files, but **only** inside its own `agents/<name>/workspace/`
  directory, and only when the routine's `permission_mode` allows edits
  (`acceptEdits` or `bypassPermissions`). Most routines run `default`
  with an `allowed_tools` list that contains no file-writing tool, which
  is what makes them read-only; `plan` mode is not used because `claude -p`
  refuses every MCP call in it, including the kernel's own syscalls.

## What an agent cannot do
- It cannot edit or delete anything under `raw/` — the `remember` syscall
  rejects any path starting with `raw/`, independent of what file tools
  the run was granted.
- It cannot write to `wiki/*.md` directly with file tools, even in
  `acceptEdits` mode — the kernel's contract is that all wiki mutation
  goes through `remember`, which also updates `index.md`/`log.md` and can
  refuse secrets.
- It cannot call any tool, MCP server, or external command beyond what its
  routine explicitly lists. Every `claude -p` run is spawned with
  `--strict-mcp-config`, so **only** the kernel's own `agentos` MCP server
  is available unless the routine sets `extra_mcp` to opt in to something
  else.
- It cannot resolve its own (or anyone else's) approval request.
  `request_approval` only ever creates a `pending` `Decision`; no syscall,
  skill, or agent can flip it to `approved`/`rejected`. That happens only
  through the dashboard's Approve/Reject buttons or the CLI's
  `agentos approve|reject <id>`, both operated by a human, or the matching
  label/comment on the decision's GitHub issue by the repo owner. The only
  non-human transition is `expired`, applied by the kernel's clock after 7
  undecided days; it never approves anything.
- It cannot reach the network beyond what `WebFetch`/`WebSearch` or an
  adapter's own HTTP calls do — there is no generic shell/exec tool
  granted to any built-in routine.

## The `--strict-mcp-config` point
Every spawned `claude -p` process gets exactly one MCP server: the
kernel's own stdio server (`syscall/bin.ts`), configured per-run in
`.agentos/runs/<runId>/mcp.json` with a single-use `X-Run-Token`. Without
`--strict-mcp-config`, a run could pick up MCP servers from a user- or
project-level Claude Code config on the host machine — untrusted or
unrelated tools the routine author never approved. `--strict-mcp-config`
closes that off: what's in the generated `mcp.json` is what's available,
nothing else.

## Where secrets live
- Nothing under `os/` (raw/, wiki/, skills/, agents/) ever contains a
  secret. `remember` scans every write with `wiki/redact.ts`
  (`findSecrets`) against AWS/GitHub/OpenAI/Anthropic key patterns and
  `-----BEGIN ... PRIVATE KEY-----` blocks; a match throws
  `SecretDetectedError` and logs a `security.redacted` event instead of
  writing the page.
- Real secrets (a GitHub token, API keys) live only in `.env`
  (gitignored) or the environment the daemon was started in. GitHub
  operations reuse the local `gh` CLI login rather than a stored token.
- `.gitleaks.toml` defines the ruleset that catches anything that slips
  past `remember` before it reaches a commit; CI runs the official
  gitleaks action on every push to `main`, every `v*` tag, and every
  pull request into `main`.

## The `gh` CLI
Everything agent-os knows about GitHub — the operator's repo list, a
project's default branch, and the presence of `package.json`/
`pyproject.toml`/`Makefile` used to infer build checks — comes from
shelling out to the operator's own `gh` CLI (`packages/kernel/src/github/gh.ts`),
never from a stored token. Every call goes through `execa(bin, [...args])`
with an argument array — never a shell string — and every repo name is
checked against `^[\w.-]+\/[\w.-]+$` (`assertValidRepoName`) before it is
used in an argv element or a filesystem path segment. `gh`'s own local
login (`gh auth login`, outside agent-os entirely) is the only credential
involved; if it isn't present, `GET /api/github/repos` and `POST
/api/projects` return `503 { error: 'gh not available', hint }` rather
than failing partway through. Tests and CI never touch the real `gh`
binary — `AGENTOS_GH_BIN` points them at `tools/fake-gh/bin.js`, a
fixture-driven stand-in with the same shape as `tools/fake-claude`.

## Local secret scanning
This repo does not ship an automated pre-commit hook. Before committing,
run gitleaks yourself against your staged changes:

```
gitleaks protect --staged --config .gitleaks.toml
```

CI runs the same `.gitleaks.toml` ruleset via the official gitleaks
action on every push to `main`, every `v*` tag, and every pull request
into `main` (see `.github/workflows/ci.yml`), so anything missed
locally on one of those paths is still caught before it lands.

## The approval boundary
An adapter's `applyDecision` (e.g. flipping a TechPulse proposal's
frontmatter to `approved` and pushing to `main`) only ever runs *after* a
human resolves the `Decision` via the dashboard or CLI. The run that
called `request_approval` has already ended by then — no agent process is
executing when the human clicks Approve. This is the one place agent-os
lets an agent's work reach a real external system (a git push to a real
repo), so it is the one action gated on an explicit human click, logged as
a `git.commit`/`git.push` event carrying the resolving run id.

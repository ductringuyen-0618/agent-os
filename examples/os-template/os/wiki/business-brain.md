---
title: Business Brain
type: note
sources: []
updated: 2026-09-08
tags: [business-brain, context]
---

# Business Brain — Acme Devtools (example)

> Replace this entire page with your own context after `agentos init`.
> This fictional example shows the shape and level of detail expected;
> no real company, person, or account is referenced.

## Who we are
Acme Devtools is a fictional 6-person startup building a hosted log
aggregation product for small engineering teams. Founder-led, no board,
bootstrapped. Primary users: 2-10 person startups already using GitHub
Actions and wanting cheaper log search than the big vendors.

## Product
- **acme-logs** — ingest agent (Go) + search UI (React) + billing (Stripe
  metered usage). Public repo placeholder: see `projects/example.yaml` or
  your own real project config.
- Current focus: cutting p95 query latency and shipping a Slack alerting
  integration.

## How this instance is used
A `techpulse-coo`-style adapter mirrors a target repo's
`docs/missions/coo/proposals/` folder into `raw/`. The `ingest` skill
turns each proposal into a wiki page; `ops` requests approval for
anything still `status: proposed`.

## People (fictional, for shape only)
- **Jordan** — founder, approves/rejects all proposals from the dashboard.
- **Riley** — the only other engineer; work shows up as commits, not as
  an agent-os user.

## Guardrails
- No customer PII may be copied into `raw/` or the wiki — link to it,
  don't paste it.
- Anything touching billing or auth changes needs a human decision, never
  an auto-applied one.

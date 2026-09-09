# 2-minute demo script

Goal: show a heartbeat running, the wiki compounding, and a proposal
approved from the dashboard triggering a real git push — in under 2
minutes. Record with [ScreenToGif](https://www.screentogif.com/) (Windows)
or capture with `ffmpeg -f gdigrab -framerate 15 -i desktop demo.mp4` then
convert: `ffmpeg -i demo.mp4 -vf "fps=12,scale=960:-1" docs/demo.gif`.

Output file: `docs/demo.gif`, referenced from the root `README.md` hero
section as `![agent-os demo](docs/demo.gif)`.

## Panels/windows to have open before recording
1. Terminal, repo root, sized ~100x30.
2. Browser at `http://127.0.0.1:4545` (dashboard), **Runs** panel active.
3. A second browser tab on the **Wiki** panel, `index.md` open.

## Script (timestamps are targets, not hard cuts)

**0:00-0:15 — Quickstart**
```bash
pnpm i
pnpm build
node packages/cli/dist/bin.js init ./demo-os
node packages/cli/dist/bin.js up --root ./demo-os/os
```
Caption: "agent-os spins up a daemon, a wiki, and a dashboard from one
`init` + `up`."

**0:15-0:35 — Heartbeat + wiki panel**
Switch to the dashboard **Agents** panel: show `ops` go `idle → working`
on the heartbeat tick. Switch to **Wiki**, show `log.md` gaining a new
line.
```bash
node packages/cli/dist/bin.js routines run heartbeat
```
Caption: "A heartbeat runs every 30 minutes here — sped up for the demo
by running it on demand."

**0:35-1:10 — A proposal appears**
```bash
node packages/cli/dist/bin.js sync techpulse
```
Switch to **Decisions** panel: a new pending card appears with the
proposal's title. Caption: "The adapter mirrored a `status: proposed`
file into `raw/`; `ingest` turned it into a wiki page and asked for
approval — nothing was pushed yet."

**1:10-1:40 — Approve it**
Click **Approve** on the card. Switch to **Runs**: a `git.commit` then
`git.push` event appears. Caption: "Approving in the dashboard is the
only thing that lets agent-os touch the real repo — the commit and push
are logged as events tied to this decision."

**1:40-2:00 — Wrap**
Switch to **Wiki**, open the proposal's page: show the decision recorded
on it with a link to the commit. Caption: "Everything the agents did —
and why — is sitting in a wiki you can read, diff, and git-blame like
code."

## Recording checklist
- [ ] Terminal font size increased for legibility.
- [ ] Browser zoom at 100%, window at least 1280x800.
- [ ] No real business data on screen — use `demo-os` from `agentos init`,
      not a private instance.
- [ ] Export at 12-15fps, scaled to 960px wide, under 8MB for GitHub's
      README inline rendering limit.

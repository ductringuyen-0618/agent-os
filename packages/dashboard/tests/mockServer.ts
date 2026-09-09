import type {
  Decision,
  Event,
  RoutineConfig,
  Run,
  SkillMeta,
} from "@agentos/shared";
import { vi } from "vitest";

export const fixtures = {
  run: {
    id: "run_1",
    routine: "heartbeat",
    status: "success",
    attempt: 1,
  } satisfies Run,
  events: [
    {
      id: 1,
      ts: "2026-09-08T00:00:00Z",
      type: "run.started",
      runId: "run_1",
      payload: {},
    },
  ] satisfies Event[],
  decision: {
    id: "dec_1",
    title: "Approve proposal",
    body: "# Proposal\nDo the thing.",
    status: "pending",
    createdAt: "2026-09-08T00:00:00Z",
  } satisfies Decision,
  routine: { name: "heartbeat", every: "30m" } satisfies RoutineConfig,
  skill: {
    name: "heartbeat",
    path: "skills/heartbeat",
    hasLearnings: true,
    lastScore: 0.9,
  } satisfies SkillMeta,
};

type Handler = (url: URL, init?: RequestInit) => unknown;

export function installMockFetch(overrides: Record<string, Handler> = {}) {
  const routes: Record<string, Handler> = {
    "GET /api/health": () => ({ ok: true, version: "0.1.0" }),
    "GET /api/runs": () => [fixtures.run],
    "GET /api/runs/run_1": () => fixtures.run,
    "GET /api/runs/run_1/events": () => fixtures.events,
    "POST /api/runs/run_1/kill": () => ({ ok: true }),
    "GET /api/decisions": () => [fixtures.decision],
    "POST /api/decisions/dec_1/approve": () => ({
      ...fixtures.decision,
      status: "approved",
    }),
    "POST /api/decisions/dec_1/reject": () => ({
      ...fixtures.decision,
      status: "rejected",
    }),
    "GET /api/routines": () => [
      { routine: fixtures.routine, nextRun: "2026-09-08T01:00:00Z" },
    ],
    "POST /api/routines/heartbeat/run": () => ({ runId: "run_2" }),
    "POST /api/routines/heartbeat/enable": () => ({ ok: true }),
    "POST /api/routines/heartbeat/disable": () => ({ ok: true }),
    "GET /api/wiki/index": () => ({ content: "# Index" }),
    "GET /api/wiki/log": () => ({ content: "## [2026-09-08] note | Hello" }),
    "GET /api/wiki/page": () => ({
      content: "# Page\nSee [[projects/techpulse]].",
    }),
    "GET /api/skills": () => [fixtures.skill],
    "GET /api/skills/heartbeat": () => ({
      skillMd: "# skill",
      learningsMd: "# learnings",
      eval: { criteria: [] },
      lastOutputMd: "# output",
    }),
    "GET /api/agents": () => [{ name: "ops", status: "idle" }],
    "GET /api/costs": () => [
      { day: "2026-09-08", agent: "ops", costUsd: 0.42 },
    ],
    ...overrides,
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input, "http://localhost");
      const key = `${init?.method ?? "GET"} ${url.pathname}`;
      const handler = routes[key];
      if (!handler)
        return new Response(JSON.stringify({ error: `no mock for ${key}` }), {
          status: 404,
        });
      const body = handler(url, init);
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );
}

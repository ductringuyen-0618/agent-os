import fs from 'node:fs/promises'
import path from 'node:path'
import {
  type RoutineConfig,
  type RoutinesFile,
  parseRoutinesFile,
} from '@agentos/shared'
import type { FastifyInstance } from 'fastify'
import { nanoid } from 'nanoid'
import { AdapterHost } from './adapters/adapterHost.js'
import { buildServer } from './api/server.js'
import type { KernelConfig } from './config.js'
import { EventLog } from './log/eventLog.js'
import { writeRunMcpConfig } from './process/mcpConfig.js'
import { ProcessManager } from './process/processManager.js'
import { assemblePrompt } from './process/promptAssembler.js'
import { Scheduler } from './scheduler/scheduler.js'
import { WikiService } from './wiki/wikiService.js'

export interface Kernel {
  cfg: KernelConfig
  log: EventLog
  pm: ProcessManager
  scheduler: Scheduler
  wiki: WikiService
  adapters: AdapterHost
  start(): Promise<void>
  stop(): Promise<void>
}

async function loadRoutinesFile(osRoot: string): Promise<RoutinesFile> {
  const text = await fs.readFile(path.join(osRoot, 'routines.yaml'), 'utf8')
  return parseRoutinesFile(text)
}

class KernelImpl implements Kernel {
  log: EventLog
  pm: ProcessManager
  scheduler: Scheduler
  wiki: WikiService
  adapters: AdapterHost
  private server: FastifyInstance | undefined
  private routinesFile: RoutinesFile | undefined

  constructor(public cfg: KernelConfig) {
    this.log = new EventLog(cfg.dbPath)
    this.pm = new ProcessManager(cfg, this.log)
    this.wiki = new WikiService(cfg.osRoot, this.log)
    this.adapters = new AdapterHost(cfg, this.log, this.wiki, {})
    this.scheduler = new Scheduler(cfg, this.log, (routine, payload) =>
      this.exec(routine, payload),
    )
  }

  private async exec(
    routine: RoutineConfig,
    payload?: Record<string, unknown>,
  ): Promise<void> {
    this.routinesFile ??= await loadRoutinesFile(this.cfg.osRoot)

    if (routine.adapter) {
      await this.adapters.sync(routine.adapter) // no-op until M4 registers real adapters
      return
    }
    if (!routine.skill || !routine.agent) {
      throw new Error(
        `routine ${routine.name} has neither adapter nor skill+agent`,
      )
    }
    const activeRun = this.log.listRuns({
      routine: routine.name,
      status: 'running',
      limit: 1,
    })[0]
    if (!activeRun) {
      throw new Error(`no running Run found for routine ${routine.name}`)
    }

    const task =
      routine.skill === 'heartbeat'
        ? JSON.stringify({
            unindexedRaw: await this.wiki.listUnindexedRaw(),
            routineStatus: this.scheduler
              .list()
              .map(({ routine: r, nextRun, lastRun }) => ({
                name: r.name,
                enabled: r.enabled !== false,
                nextRun: nextRun ?? null,
                lastRun: lastRun
                  ? { status: lastRun.status, endedAt: lastRun.endedAt ?? null }
                  : null,
              })),
          })
        : JSON.stringify(payload ?? {})

    const assembled = await assemblePrompt({
      osRoot: this.cfg.osRoot,
      skill: routine.skill,
      agent: routine.agent,
      task,
    })
    // The syscall route (M2 api/internal.ts) authenticates by this token --
    // it MUST be registered before the run starts.
    const runToken = nanoid()
    this.log.createRunToken(activeRun.id, runToken)
    const mcpConfigPath = await writeRunMcpConfig(
      this.cfg.runtimeDir,
      activeRun,
      `http://${this.cfg.host}:${this.cfg.port}`,
      runToken,
      routine.extra_mcp,
    )
    // biome-ignore lint/style/noNonNullAssertion: set unconditionally at the top of exec()
    const defaults = this.routinesFile!.defaults
    const cwd = path.join(this.cfg.osRoot, 'agents', routine.agent, 'workspace')
    await fs.mkdir(cwd, { recursive: true })
    const common = {
      cwd,
      model: routine.model ?? defaults.model,
      permissionMode: routine.permission_mode ?? defaults.permission_mode,
      allowedTools: routine.allowed_tools ?? defaults.allowed_tools,
      addDirs: [this.cfg.osRoot],
      mcpConfigPath,
      timeoutMs: routine.timeout_ms ?? defaults.timeout_ms,
    }
    // runToCompletion (M2) = main turn + kernel-driven wrap-up turn via
    // --resume; never call pm.start() directly here.
    const result = await this.pm.runToCompletion(
      activeRun,
      {
        prompt: assembled.prompt,
        systemPromptAppend: assembled.systemPromptAppend,
        ...common,
      },
      { skill: routine.skill, osRoot: this.cfg.osRoot, ...common },
    )
    this.log.updateRun(activeRun.id, {
      costUsd: result.costUsd,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      sessionId: result.sessionId,
    })
    if (result.status !== 'success') {
      throw new Error(
        result.error ??
          `run ${routine.name} ended with status ${result.status}`,
      )
    }
  }

  async start(): Promise<void> {
    await fs.mkdir(this.cfg.runtimeDir, { recursive: true })
    this.routinesFile = await loadRoutinesFile(this.cfg.osRoot)
    this.scheduler.load(this.routinesFile)
    this.server = buildServer(this)
    await this.server.listen({ host: this.cfg.host, port: this.cfg.port })
    this.scheduler.start()
  }

  async stop(): Promise<void> {
    this.scheduler.stop()
    await this.server?.close()
    this.log.close()
  }
}

export function createKernel(cfg: KernelConfig): Kernel {
  return new KernelImpl(cfg)
}

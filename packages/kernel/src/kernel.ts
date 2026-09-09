import fs from 'node:fs/promises'
import type { FastifyInstance } from 'fastify'
import { AdapterHost } from './adapters/adapterHost.js'
import { buildServer } from './api/server.js'
import type { KernelConfig } from './config.js'
import { EventLog } from './log/eventLog.js'
import { ProcessManager } from './process/processManager.js'
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

class KernelImpl implements Kernel {
  log: EventLog
  pm: ProcessManager
  scheduler: Scheduler
  wiki: WikiService
  adapters: AdapterHost
  private server: FastifyInstance | undefined

  constructor(public cfg: KernelConfig) {
    this.log = new EventLog(cfg.dbPath)
    this.pm = new ProcessManager(cfg, this.log)
    this.wiki = new WikiService(cfg.osRoot, this.log)
    this.adapters = new AdapterHost(cfg, this.log, this.wiki, {})
    this.scheduler = new Scheduler(cfg, this.log, async () => {
      // wired for real in M3; unused in M1
    })
  }

  async start(): Promise<void> {
    await fs.mkdir(this.cfg.runtimeDir, { recursive: true })
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

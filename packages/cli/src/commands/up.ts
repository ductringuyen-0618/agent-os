import { createKernel, loadKernelConfig } from '@agentos/kernel'

export interface UpOptions {
  root: string
  port?: string
}

export async function up(opts: UpOptions): Promise<void> {
  const cfg = loadKernelConfig(
    opts.root,
    opts.port ? { port: Number(opts.port) } : undefined,
  )
  const kernel = createKernel(cfg)
  await kernel.start()
  console.log(
    `agent-os daemon listening on http://${cfg.host}:${cfg.port} (osRoot=${cfg.osRoot})`,
  )

  const shutdown = async () => {
    console.log('agent-os daemon shutting down...')
    await kernel.stop()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

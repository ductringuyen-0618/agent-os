import { adapterRegistry } from '@agentos/adapters'
import {
  type Kernel,
  type WorkflowDefinition,
  createFeatureRequestCwdPolicy,
  createFeatureRequestWorkflow,
  createKernel,
  loadKernelConfig,
} from '@agentos/kernel'

export interface UpOptions {
  root: string
  port?: string
}

export async function up(opts: UpOptions): Promise<void> {
  const cfg = loadKernelConfig(
    opts.root,
    opts.port ? { port: Number(opts.port) } : undefined,
  )

  // `kernel` is assigned right after createKernel(...) returns, below --
  // getKernel()/getCachedProjects() are only ever *called* from inside a
  // running workflow's run() or the engine's cwdPolicy hook, both of which
  // happen well after that assignment (see featureRequest.ts's
  // FeatureRequestDeps doc comment for why this indirection exists at all).
  // biome-ignore lint/style/useConst: assigned below, after the closures that capture it are constructed
  let kernel: Kernel
  const featureRequestWorkflow = createFeatureRequestWorkflow({
    registry: adapterRegistry,
    getKernel: () => kernel,
  })
  const cwdPolicy = createFeatureRequestCwdPolicy(cfg.osRoot, () =>
    kernel.adapters.getCachedProjects(),
  )

  // createKernel's third parameter is a heterogeneous WorkflowDefinition[]
  // (its own default type param, Record<string, unknown>) -- each
  // definition's `run` is contravariant in its own input type, so a
  // specifically-typed WorkflowDefinition<FeatureRequestInput> can't
  // satisfy that bare element type without this widening cast. The
  // WorkflowRegistry it feeds (packages/kernel/src/workflow/registry.ts)
  // stores definitions the same way (Map<string, WorkflowDefinition<any>>)
  // -- type specificity for `I` only matters inside the definition's own
  // module, not at the registration boundary.
  kernel = createKernel(
    cfg,
    adapterRegistry,
    [featureRequestWorkflow as unknown as WorkflowDefinition],
    cwdPolicy,
  )
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

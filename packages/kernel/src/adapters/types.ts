import type { Decision, EventType, ProjectConfig } from '@agentos/shared'
import type { KernelConfig } from '../config.js'
import type { EventLog } from '../log/eventLog.js'
import type { WikiService } from '../wiki/wikiService.js'

export interface AdapterContext {
  cfg: KernelConfig
  log: EventLog
  wiki: WikiService
  project: ProjectConfig
  runId?: string
}

export interface SyncResult {
  added: string[]
  changed: string[]
  events: EventType[]
  hasCooLayout?: boolean
}

export interface FeatureRequestPushProposalInput {
  slug: string
  title: string
  proposalBody: string
  status: 'approved' | 'proposed'
}

export interface FeatureRequestPushProposalResult {
  file: string
  sha: string
  bootstrapped: boolean
}

export interface FeatureRequestOpenPrInput {
  branch: string
  slug: string
  title: string
  proposalFile: string
  proposalWhatWhy: string
  validationOutput: string
  reviewOutput: string
}

export interface FeatureRequestOpenPrResult {
  /** Empty when no pull request could be opened (see `skipped`). */
  url: string
  number: number
  /** Set when the branch was pushed but no PR exists, e.g. a non-GitHub remote. */
  skipped?: string
}

export interface FeatureRequestWriteReportInput {
  slug: string
  branch: string
  prUrl: string
  validationOutput: string
  reviewOutput: string
}

export interface FeatureRequestWriteReportResult {
  file: string
  sha: string
}

/**
 * Adapter-specific operations the `feature-request` workflow (spec §5)
 * needs beyond sync/applyDecision. Optional on ProjectAdapter -- only
 * adapters that manage a proposals layout (currently just techpulse-coo)
 * implement it; the workflow refuses a project whose adapter doesn't.
 */
export interface FeatureRequestAdapterOps {
  bootstrapLayout(ctx: AdapterContext): Promise<{ created: string[] }>
  pushProposal(
    ctx: AdapterContext,
    input: FeatureRequestPushProposalInput,
  ): Promise<FeatureRequestPushProposalResult>
  openPullRequest(
    ctx: AdapterContext,
    input: FeatureRequestOpenPrInput,
  ): Promise<FeatureRequestOpenPrResult>
  markShipped(
    ctx: AdapterContext,
    slug: string,
    proposalFile: string,
  ): Promise<{ sha: string }>
  writeReport(
    ctx: AdapterContext,
    input: FeatureRequestWriteReportInput,
  ): Promise<FeatureRequestWriteReportResult>
}

export interface ProjectAdapter {
  name: string
  sync(ctx: AdapterContext): Promise<SyncResult>
  applyDecision(decision: Decision, ctx: AdapterContext): Promise<void>
  featureRequests?: FeatureRequestAdapterOps
}

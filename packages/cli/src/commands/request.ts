import type { FeatureRequestInput } from '@agentos/shared'
import type { ApiClient } from '../client.js'

export interface RequestOptions {
  project: string
  title: string
  description?: string
  file?: string
  autoApprove: boolean
}

async function defaultReadFile(path: string): Promise<string> {
  const fs = await import('node:fs/promises')
  return fs.readFile(path, 'utf8')
}

export async function requestFeature(
  client: ApiClient,
  opts: RequestOptions,
  readFile: (path: string) => Promise<string> = defaultReadFile,
): Promise<string> {
  if (!opts.description && !opts.file) {
    throw new Error('one of --description or --file is required')
  }
  const description = opts.file
    ? await readFile(opts.file)
    : // biome-ignore lint/style/noNonNullAssertion: checked above
      opts.description!

  const input: FeatureRequestInput = {
    project: opts.project,
    title: opts.title,
    description,
    autoApprove: opts.autoApprove,
  }
  const { workflowId } = await client.createWorkflow({
    kind: 'feature-request',
    project: opts.project,
    title: opts.title,
    // ApiClient.createWorkflow's body is typed generically
    // (Record<string, unknown>) since it accepts any workflow kind's
    // input shape; FeatureRequestInput's fields are all plain
    // JSON-serializable values, so this is a safe widening.
    input: input as unknown as Record<string, unknown>,
  })
  console.log(`started feature request ${workflowId}`)
  return workflowId
}

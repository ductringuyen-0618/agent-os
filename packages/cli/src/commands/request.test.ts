import { describe, expect, it, vi } from 'vitest'
import type { ApiClient } from '../client.js'
import { requestFeature } from './request.js'

describe('requestFeature', () => {
  it('creates a feature-request workflow from --description', async () => {
    const client = {
      createWorkflow: vi.fn().mockResolvedValue({ workflowId: 'wf-1' }),
    } as unknown as ApiClient
    const id = await requestFeature(client, {
      project: 'techpulse',
      title: 'Add dark mode',
      description: 'Users want a toggle.',
      autoApprove: true,
    })
    expect(id).toBe('wf-1')
    expect(client.createWorkflow).toHaveBeenCalledWith({
      kind: 'feature-request',
      project: 'techpulse',
      title: 'Add dark mode',
      input: {
        project: 'techpulse',
        title: 'Add dark mode',
        description: 'Users want a toggle.',
        autoApprove: true,
      },
    })
  })

  it('reads the description from --file when given', async () => {
    const client = {
      createWorkflow: vi.fn().mockResolvedValue({ workflowId: 'wf-2' }),
    } as unknown as ApiClient
    const readFile = vi.fn().mockResolvedValue('from the file\n')
    const id = await requestFeature(
      client,
      { project: 'p', title: 't', file: 'brief.md', autoApprove: false },
      readFile,
    )
    expect(id).toBe('wf-2')
    expect(readFile).toHaveBeenCalledWith('brief.md')
    expect(client.createWorkflow).toHaveBeenCalledWith({
      kind: 'feature-request',
      project: 'p',
      title: 't',
      input: {
        project: 'p',
        title: 't',
        description: 'from the file\n',
        autoApprove: false,
      },
    })
  })

  it('throws when neither --description nor --file is given', async () => {
    const client = { createWorkflow: vi.fn() } as unknown as ApiClient
    await expect(
      requestFeature(client, { project: 'p', title: 't', autoApprove: true }),
    ).rejects.toThrow(/--description|--file/)
    expect(client.createWorkflow).not.toHaveBeenCalled()
  })
})

import type { ProjectConfig } from '@agentos/shared'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { installMockFetch } from '../../tests/mockServer'
import { NewRequestForm } from './NewRequestForm'
import { ToastProvider } from './Toast'

const projects: ProjectConfig[] = [
  {
    name: 'techpulse',
    adapter: 'techpulse-coo',
    repo: 'me/techpulse',
    clone: '/clones/techpulse',
    base_branch: 'main',
    options: {},
  },
]

describe('NewRequestForm', () => {
  it('rejects submission with a blank title', async () => {
    installMockFetch()
    const onCreated = vi.fn()
    render(
      <ToastProvider>
        <NewRequestForm projects={projects} onCreated={onCreated} />
      </ToastProvider>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Start request' }))
    expect(
      screen.getByText('Give the request a short title.'),
    ).toBeInTheDocument()
    expect(onCreated).not.toHaveBeenCalled()
  })

  it('starts a request and reports the new workflow id', async () => {
    installMockFetch()
    const onCreated = vi.fn()
    render(
      <ToastProvider>
        <NewRequestForm projects={projects} onCreated={onCreated} />
      </ToastProvider>,
    )
    await userEvent.type(
      screen.getByLabelText('Title'),
      'Add a personalized company digest',
    )
    await userEvent.type(
      screen.getByLabelText('Description'),
      'Summarize the week per company the user follows.',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Start request' }))
    expect(
      await screen.findByText(/Request started: Add a personalized/),
    ).toBeInTheDocument()
    expect(onCreated).toHaveBeenCalledWith('wf_2')
  })

  it('shows a toast when the request fails to start', async () => {
    installMockFetch({
      'POST /api/workflows': () => {
        throw new Error('boom')
      },
    })
    render(
      <ToastProvider>
        <NewRequestForm projects={projects} onCreated={() => {}} />
      </ToastProvider>,
    )
    await userEvent.type(screen.getByLabelText('Title'), 'Add a widget')
    await userEvent.type(
      screen.getByLabelText('Description'),
      'A short description.',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Start request' }))
    expect(
      await screen.findByText(/Failed to start the request/),
    ).toBeInTheDocument()
  })
})

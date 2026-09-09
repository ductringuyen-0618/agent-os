import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { installMockFetch } from '../../tests/mockServer'
import { AddProjectDialog } from './AddProjectDialog'
import { ToastProvider } from './Toast'

describe('AddProjectDialog', () => {
  it('lists repos, submits the selected one, and reports the result', async () => {
    installMockFetch()
    const onAdded = vi.fn()
    render(
      <ToastProvider>
        <AddProjectDialog open onClose={() => {}} onAdded={onAdded} />
      </ToastProvider>,
    )

    expect(await screen.findByText('octo/widgets')).toBeInTheDocument()
    await userEvent.click(screen.getByText('octo/widgets'))
    await userEvent.click(screen.getByRole('button', { name: /add project/i }))

    await waitFor(() => expect(onAdded).toHaveBeenCalled())
    expect(onAdded.mock.calls[0][0].project.name).toBe('widgets')
  })

  it('shows the gh-unavailable hint instead of the repo list on 503', async () => {
    installMockFetch({
      'GET /api/github/repos': () =>
        new Response(
          JSON.stringify({
            error: 'gh not available',
            hint: 'run gh auth login',
          }),
          { status: 503 },
        ),
    })
    render(
      <ToastProvider>
        <AddProjectDialog open onClose={() => {}} onAdded={() => {}} />
      </ToastProvider>,
    )
    expect(await screen.findByText(/run gh auth login/i)).toBeInTheDocument()
  })

  it('does not render when open is false', () => {
    installMockFetch()
    render(
      <ToastProvider>
        <AddProjectDialog open={false} onClose={() => {}} onAdded={() => {}} />
      </ToastProvider>,
    )
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })
})

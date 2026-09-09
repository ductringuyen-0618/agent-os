import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { fixtures, installMockFetch } from '../../tests/mockServer'
import { ToastProvider } from '../components/Toast'
import { ProjectsPanel } from './ProjectsPanel'

function renderPanel() {
  return render(
    <ToastProvider>
      <ProjectsPanel />
    </ToastProvider>,
  )
}

describe('ProjectsPanel', () => {
  it('lists projects with adapter, base branch, and hasCooLayout copy for a fresh sync', async () => {
    installMockFetch({
      'GET /api/projects': () => [
        { ...fixtures.projectListItem, hasCooLayout: false },
      ],
    })
    renderPanel()
    expect(await screen.findByText('techpulse')).toBeInTheDocument()
    expect(screen.getByText(/no proposals folder yet/i)).toBeInTheDocument()
  })

  it('shows empty state with no projects', async () => {
    installMockFetch({ 'GET /api/projects': () => [] })
    renderPanel()
    expect(await screen.findByText(/no projects/i)).toBeInTheDocument()
  })

  it('opens the Add from GitHub dialog', async () => {
    installMockFetch({ 'GET /api/projects': () => [] })
    renderPanel()
    await userEvent.click(
      await screen.findByRole('button', { name: /add from github/i }),
    )
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument()
  })

  it('removes a project after confirmation', async () => {
    installMockFetch()
    renderPanel()
    await userEvent.click(
      await screen.findByRole('button', { name: /remove/i }),
    )
    await userEvent.click(
      await screen.findByRole('button', { name: /confirm/i }),
    )
    await waitFor(() =>
      expect(
        screen.queryByText(fixtures.projectListItem.config.name),
      ).not.toBeInTheDocument(),
    )
  })
})

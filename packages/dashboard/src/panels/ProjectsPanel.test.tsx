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

describe('ProjectsPanel setup state', () => {
  it('shows a pending project with its setup PR and a check button, no sync', async () => {
    installMockFetch({
      'GET /api/projects': () => [fixtures.pendingProjectListItem],
    })
    renderPanel()
    expect(await screen.findByText('widgets')).toBeInTheDocument()
    expect(screen.getByText('not set up')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Setup PR #7' })).toHaveAttribute(
      'href',
      'https://github.com/octo/widgets/pull/7',
    )
    expect(
      screen.queryByRole('button', { name: /sync now/i }),
    ).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /check setup/i }))
    expect(await screen.findByText(/still open/i)).toBeInTheDocument()
  })

  it('labels the adapter by what it does', async () => {
    installMockFetch()
    renderPanel()
    expect(await screen.findByText('COO missions')).toBeInTheDocument()
  })
})

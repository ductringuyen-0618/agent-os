import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { installMockFetch } from '../../tests/mockServer'
import { ToastProvider } from '../components/Toast'
import { RoutinesPanel } from './RoutinesPanel'

describe('RoutinesPanel', () => {
  it('runs a routine now', async () => {
    const run = vi.fn(() => ({ runId: 'run_9' }))
    installMockFetch({ 'POST /api/routines/heartbeat/run': run })
    render(
      <ToastProvider>
        <RoutinesPanel />
      </ToastProvider>,
    )
    await userEvent.click(
      await screen.findByRole('button', { name: /run now/i }),
    )
    expect(run).toHaveBeenCalled()
  })
})

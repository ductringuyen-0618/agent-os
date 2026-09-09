import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { installMockFetch } from '../../tests/mockServer'
import { ToastProvider } from '../components/Toast'
import { DecisionsPanel } from './DecisionsPanel'

describe('DecisionsPanel', () => {
  it('lists pending decisions', async () => {
    installMockFetch()
    render(
      <ToastProvider>
        <DecisionsPanel />
      </ToastProvider>,
    )
    expect(
      await screen.findByRole('heading', { name: 'Decisions' }),
    ).toBeInTheDocument()
    expect(await screen.findByText('Approve proposal')).toBeInTheDocument()
  })
})

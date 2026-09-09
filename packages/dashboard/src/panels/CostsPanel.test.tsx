import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { installMockFetch } from '../../tests/mockServer'
import { CostsPanel } from './CostsPanel'

describe('CostsPanel', () => {
  it('renders an svg bar per day', async () => {
    installMockFetch({
      'GET /api/costs': () => [
        { day: '2026-09-07', agent: 'ops', costUsd: 0.1 },
        { day: '2026-09-08', agent: 'ops', costUsd: 0.4 },
      ],
    })
    render(<CostsPanel />)
    expect(await screen.findByTestId('cost-bar-2026-09-08')).toBeInTheDocument()
  })
})

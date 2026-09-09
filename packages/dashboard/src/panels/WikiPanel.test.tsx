import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { installMockFetch } from '../../tests/mockServer'
import { WikiPanel } from './WikiPanel'

describe('WikiPanel', () => {
  it('renders the index by default', async () => {
    installMockFetch()
    render(<WikiPanel />)
    expect(
      await screen.findByRole('heading', { name: 'Index' }),
    ).toBeInTheDocument()
  })
})

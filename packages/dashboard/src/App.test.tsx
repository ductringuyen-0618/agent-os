import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { installMockFetch } from '../tests/mockServer'
import App from './App'

describe('App', () => {
  it('switches panels via left nav', async () => {
    installMockFetch()
    render(<App />)
    expect(
      screen.getByRole('navigation', { name: /agent-os/i }),
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Decisions' }))
    expect(
      await screen.findByRole('heading', { name: 'Decisions' }),
    ).toBeInTheDocument()
  })
})

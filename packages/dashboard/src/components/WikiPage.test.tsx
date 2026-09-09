import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { WikiPage } from './WikiPage'

describe('WikiPage', () => {
  it('turns [[Wikilinks]] into clickable in-app links', async () => {
    const onNavigate = vi.fn()
    render(
      <WikiPage
        content="See [[projects/techpulse]] for details."
        onNavigate={onNavigate}
      />,
    )
    await userEvent.click(
      screen.getByRole('link', { name: 'projects/techpulse' }),
    )
    expect(onNavigate).toHaveBeenCalledWith('projects/techpulse')
  })
})

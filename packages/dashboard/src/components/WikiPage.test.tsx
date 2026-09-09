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
    expect(onNavigate).toHaveBeenCalledWith('projects/techpulse.md')
  })
})

describe('WikiPage relative links', () => {
  it('routes plain relative markdown links in-app and resolves ../', async () => {
    const onNavigate = vi.fn()
    render(
      <WikiPage
        content={
          '---\ntitle: x\n---\nSee [state](../state.md) and [ext](https://example.com).'
        }
        onNavigate={onNavigate}
        currentPath="projects/techpulse/proposals/001.md"
      />,
    )
    expect(screen.queryByText('title: x')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('link', { name: 'state' }))
    expect(onNavigate).toHaveBeenCalledWith('projects/techpulse/state.md')
    expect(screen.getByRole('link', { name: 'ext' })).toHaveAttribute(
      'href',
      'https://example.com',
    )
  })
})

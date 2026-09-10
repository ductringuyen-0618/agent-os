import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { installMockFetch } from '../../tests/mockServer'
import { WikiPanel, groupOf } from './WikiPanel'

describe('WikiPanel', () => {
  it('lists pages grouped by folder and opens the newest one', async () => {
    installMockFetch()
    render(<WikiPanel />)
    expect(await screen.findByText('projects/techpulse')).toBeInTheDocument()
    expect(screen.getByText('concepts')).toBeInTheDocument()
    // The newest page is selected and rendered without its frontmatter.
    expect(
      await screen.findByRole('heading', { name: 'Page' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText('projects/techpulse/overview.md'),
    ).toBeInTheDocument()
  })

  it('filters the page list', async () => {
    installMockFetch()
    render(<WikiPanel />)
    await screen.findByText('projects/techpulse')
    await userEvent.type(screen.getByLabelText('Filter pages'), 'remember')
    const nav = within(screen.getByRole('navigation', { name: 'Wiki pages' }))
    expect(nav.queryByText('projects/techpulse')).not.toBeInTheDocument()
    expect(nav.getByText('concepts')).toBeInTheDocument()
  })

  it('shows the log tab', async () => {
    installMockFetch()
    render(<WikiPanel />)
    await userEvent.click(await screen.findByRole('button', { name: 'Log' }))
    expect(await screen.findByText(/note \| Hello/)).toBeInTheDocument()
  })

  it('explains an empty wiki', async () => {
    installMockFetch({ 'GET /api/wiki/pages': () => [] })
    render(<WikiPanel />)
    expect(await screen.findByText('The wiki is empty')).toBeInTheDocument()
  })
})

describe('groupOf', () => {
  it('groups project pages per project and everything else by top folder', () => {
    expect(groupOf('projects/techpulse/overview.md')).toBe('projects/techpulse')
    expect(groupOf('projects/techpulse/proposals/001.md')).toBe(
      'projects/techpulse',
    )
    expect(groupOf('concepts/x.md')).toBe('concepts')
    expect(groupOf('business-brain.md')).toBe('pages')
  })
})

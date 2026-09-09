import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { fixtures, installMockFetch } from '../../tests/mockServer'
import { SkillsPanel } from './SkillsPanel'

describe('SkillsPanel', () => {
  it('lists skills with a score and expands learnings on click', async () => {
    installMockFetch()
    render(<SkillsPanel />)
    const row = await screen.findByText(fixtures.skill.name)
    expect(screen.getByText('90%')).toBeInTheDocument()
    await userEvent.click(row)
    expect(await screen.findByText(/# learnings/)).toBeInTheDocument()
  })
})

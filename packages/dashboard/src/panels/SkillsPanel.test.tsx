import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { fixtures, installMockFetch } from '../../tests/mockServer'
import { SkillsPanel } from './SkillsPanel'

describe('SkillsPanel', () => {
  it('shows what a skill does, how it has run, and its learnings on click', async () => {
    installMockFetch()
    render(<SkillsPanel />)
    const row = await screen.findByText(fixtures.skill.name)
    expect(
      screen.getByText('Cheap, frequent pulse-check across the OS.'),
    ).toBeInTheDocument()
    expect(screen.getByText('9/10 ok')).toBeInTheDocument()
    expect(screen.getByText('via heartbeat')).toBeInTheDocument()
    expect(screen.getByText('$1.20')).toBeInTheDocument()
    expect(screen.getByText('92%')).toBeInTheDocument()
    await userEvent.click(row)
    expect(
      await screen.findByText(/routines.yaml is the source of truth/),
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Instructions' }))
    expect(
      await screen.findByRole('heading', { name: 'skill' }),
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Score' }))
    expect(await screen.findByText('accuracy')).toBeInTheDocument()
    expect(screen.getByText(/No filler\./)).toBeInTheDocument()
    expect(
      screen.getByRole('img', { name: /Score trend over 2 scored runs/ }),
    ).toBeInTheDocument()
  })

  it('says so when a skill has never run', async () => {
    installMockFetch({
      'GET /api/skills': () => [
        { name: 'query', path: 'skills/query', hasLearnings: false },
      ],
    })
    render(<SkillsPanel />)
    expect(await screen.findByText('never run')).toBeInTheDocument()
    expect(screen.queryByText('92%')).not.toBeInTheDocument()
  })

  it('shows an empty state on the Score tab for a skill that has never been scored', async () => {
    installMockFetch({
      'GET /api/skills': () => [
        { name: 'query', path: 'skills/query', hasLearnings: false },
      ],
      'GET /api/skills/query': () => ({
        skillMd: '# query',
        learningsMd: '',
        eval: { criteria: [] },
        lastOutputMd: '',
        scoreHistory: [],
      }),
    })
    render(<SkillsPanel />)
    const row = await screen.findByText('query')
    await userEvent.click(row)
    await userEvent.click(await screen.findByRole('button', { name: 'Score' }))
    expect(await screen.findByText(/No scored runs yet/)).toBeInTheDocument()
  })
})

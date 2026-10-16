import React from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import KnockoutRounds from '../components/KnockoutRounds'
import { buildKnockoutBracket, expectedSlots } from '../components/knockoutBracket'

// P3: the public bracket for an 8-team knockout. Three columns (quarter-finals,
// semi-finals, final), TBD placeholders for rounds that are not drawn yet, and
// a link from every drawn fixture to its match page.

const team = (n) => ({ _id: `t${n}`, name: `Team ${n}` })

const qf = (i, a, b, winner) => ({
  _id: `m${i}`,
  matchNumber: i,
  stage: 'quarter_final',
  stageLabel: `QF${i}`,
  status: 'completed',
  startAt: '2026-10-11T10:00:00.000Z',
  teams: [team(a), team(b)],
  result: { winner: `t${winner}` },
})

const quarterFinals = [
  qf(1, 1, 8, 1),
  qf(2, 2, 7, 2),
  qf(3, 3, 6, 3),
  qf(4, 4, 5, 4),
]

describe('buildKnockoutBracket', () => {
  it('always returns the three bracket columns', () => {
    const columns = buildKnockoutBracket(quarterFinals)
    expect(columns.map((c) => c.stage)).toEqual(['quarter_final', 'semi_final', 'final'])
    expect(columns.map((c) => c.heading)).toEqual(['Quarter-finals', 'Semi-finals', 'Final'])
  })

  it('pads rounds that are not drawn yet with TBD slots', () => {
    const columns = buildKnockoutBracket(quarterFinals)
    expect(columns[0].slots.filter(Boolean)).toHaveLength(4)
    expect(columns[1].slots).toEqual([null, null])
    expect(columns[2].slots).toEqual([null])
  })

  it('keeps an incomplete round padded to its bracket size', () => {
    const columns = buildKnockoutBracket([quarterFinals[0]])
    expect(columns[0].slots).toHaveLength(4)
    expect(columns[0].slots.filter(Boolean)).toHaveLength(1)
    expect(columns[0].slots.filter(Boolean)[0]._id).toBe('m1')
  })

  it('orders slots by their label number', () => {
    const shuffled = [quarterFinals[3], quarterFinals[0], quarterFinals[2], quarterFinals[1]]
    const columns = buildKnockoutBracket(shuffled)
    expect(columns[0].slots.map((m) => m.stageLabel)).toEqual(['QF1', 'QF2', 'QF3', 'QF4'])
  })

  it('infers the bracket size from the shallowest stage that has fixtures', () => {
    expect(expectedSlots(quarterFinals)).toEqual({ quarter_final: 4, semi_final: 2, final: 1 })
    expect(expectedSlots([{ stage: 'semi_final' }])).toEqual({ quarter_final: 0, semi_final: 2, final: 1 })
    expect(expectedSlots([])).toEqual({ quarter_final: 0, semi_final: 0, final: 0 })
  })

  it('ignores matches that are not knockout fixtures', () => {
    const columns = buildKnockoutBracket([{ _id: 'x', stage: 'group', teams: [] }, null])
    expect(columns.map((c) => c.stage)).toEqual(['quarter_final', 'semi_final', 'final'])
    expect(columns.every((c) => c.slots.every((s) => s === null))).toBe(true)
  })
})

describe('KnockoutRounds', () => {
  const renderBracket = (matches) =>
    render(
      <MemoryRouter>
        <KnockoutRounds matches={matches} />
      </MemoryRouter>,
    )

  it('renders the three bracket columns', () => {
    renderBracket(quarterFinals)

    expect(screen.getByText('Quarter-finals')).toBeTruthy()
    expect(screen.getByText('Semi-finals')).toBeTruthy()
    expect(screen.getByText('Final', { selector: 'h3' })).toBeTruthy()
  })

  it('shows TBD placeholders for the rounds that are not drawn yet', () => {
    renderBracket(quarterFinals)

    expect(screen.getAllByText('To be decided')).toHaveLength(3)
  })

  it('shows "Date TBD" for a drawn fixture with no scheduled date', () => {
    const noDate = { ...quarterFinals[0], startAt: undefined }
    renderBracket([noDate])

    expect(screen.getAllByText('Date TBD')).toHaveLength(1)
  })

  it('links every drawn fixture to its match page', () => {
    renderBracket(quarterFinals)

    const links = screen.getAllByRole('link')
    expect(links).toHaveLength(4)
    expect(links.every((link) => link.getAttribute('href')?.startsWith('/match/m'))).toBe(true)
    expect(screen.getByRole('link', { name: /Team 1/ }).getAttribute('href')).toBe('/match/m1')
  })

  it('marks the team that won each drawn fixture', () => {
    renderBracket(quarterFinals)

    expect(screen.getAllByText('WON')).toHaveLength(4)
  })

  it('shows the stage label of each slot', () => {
    renderBracket(quarterFinals)

    expect(screen.getByText('QF1')).toBeTruthy()
    expect(screen.getByText('QF4')).toBeTruthy()
  })

  it('shows an empty state when no knockout fixtures exist', () => {
    renderBracket([])

    expect(screen.getByText('Bracket not drawn yet')).toBeTruthy()
    expect(screen.queryByRole('link')).toBeNull()
  })
})

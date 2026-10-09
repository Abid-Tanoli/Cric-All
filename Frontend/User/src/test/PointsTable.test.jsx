import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import PointsTable from '../pages/PointsTable'
import { api } from '../services/api'

vi.mock('../services/api', () => ({
  api: { get: vi.fn() },
}))

const rows = [
  { _id: 'r1', team: { _id: 'team1', name: 'Alpha CC' }, matchesPlayed: 3, won: 2, lost: 1, tied: 0, noResult: 0, points: 4, netRunRate: 0.5, seriesForm: ['W', 'L', 'W'] },
  { _id: 'r2', team: { _id: 'team2', name: 'Beta CC' }, matchesPlayed: 3, won: 1, lost: 2, tied: 0, noResult: 0, points: 2, netRunRate: -0.5, seriesForm: ['L', 'W', 'L'] },
]

describe('PointsTable (Task 5)', () => {
  beforeEach(() => {
    api.get.mockReset()
    api.get.mockResolvedValue({ data: rows })
  })

  it('renders standings for the tournament it is given', async () => {
    render(<PointsTable tournamentId="t1" />)

    await waitFor(() => expect(screen.getByText('Alpha CC')).toBeTruthy())
    expect(api.get).toHaveBeenCalledWith('/tournaments/t1/points-table')
    expect(screen.getByText('Beta CC')).toBeTruthy()
  })

  it('renders standings from an event payload', async () => {
    api.get.mockResolvedValue({ data: { pointsTable: rows } })

    render(<PointsTable eventId="e1" />)

    await waitFor(() => expect(screen.getByText('Alpha CC')).toBeTruthy())
    expect(api.get).toHaveBeenCalledWith('/events/e1')
  })

  it('does not guess a tournament when no id is provided', async () => {
    render(<PointsTable />)

    await waitFor(() => expect(screen.getByText('No Points Table Available')).toBeTruthy())
    expect(api.get).not.toHaveBeenCalled()
  })
})

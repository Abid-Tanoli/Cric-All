import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Rankings from '../pages/Rankings'
import { api } from '../services/api'

vi.mock('../services/api', () => ({
  api: { get: vi.fn() },
}))

const teamRankings = [
  { _id: 'tr1', overallRank: 1, rating: 88.5, netRunRate: 1.42, team: { _id: 'team1', name: 'Alpha CC', shortName: 'ALP' } },
  { _id: 'tr2', overallRank: 2, rating: 70, netRunRate: -0.25, team: { _id: 'team2', name: 'Beta CC', shortName: 'BET' } },
]

const playerRankings = [
  { _id: 'p1', rank: 1, name: 'Striker Sam', runs: 512, wickets: 3, rankingPoints: 640, matches: 12, team: { name: 'Alpha CC' } },
  { _id: 'p2', rank: 2, name: 'Bowler Bob', runs: 40, wickets: 27, rankingPoints: 675, matches: 12, team: { name: 'Beta CC' } },
]

const callsFor = (url) => api.get.mock.calls.filter(([calledUrl]) => calledUrl === url)

describe('Rankings page (Task 4)', () => {
  beforeEach(() => {
    api.get.mockReset()
    api.get.mockImplementation((url) => {
      if (url === '/rankings-v2/overall') return Promise.resolve({ data: teamRankings })
      if (url === '/players/rankings') return Promise.resolve({ data: playerRankings })
      return Promise.resolve({ data: [] })
    })
  })

  it('shows the team leaderboard with working profile links', async () => {
    render(
      <MemoryRouter>
        <Rankings />
      </MemoryRouter>
    )

    await waitFor(() => expect(screen.getByText('Alpha CC')).toBeTruthy())
    expect(screen.getByText('Beta CC')).toBeTruthy()
    expect(callsFor('/rankings-v2/overall').length).toBeGreaterThan(0)

    const link = screen.getByText('Alpha CC').closest('a')
    expect(link.getAttribute('href')).toBe('/teams/team1')
  })

  it('switches to the player leaderboard and requests the selected board', async () => {
    render(
      <MemoryRouter>
        <Rankings />
      </MemoryRouter>
    )

    fireEvent.click(screen.getByRole('button', { name: 'Player Rankings' }))
    await waitFor(() => expect(screen.getByText('Striker Sam')).toBeTruthy())

    const firstCall = callsFor('/players/rankings')[0]
    expect(firstCall[1].params.type).toBe('batting')

    const link = screen.getByText('Striker Sam').closest('a')
    expect(link.getAttribute('href')).toBe('/players/p1')
  })

  it('requests a different player board when a discipline is selected', async () => {
    render(
      <MemoryRouter>
        <Rankings />
      </MemoryRouter>
    )
    fireEvent.click(screen.getByRole('button', { name: 'Player Rankings' }))
    await waitFor(() => expect(callsFor('/players/rankings').length).toBeGreaterThan(0))

    fireEvent.click(screen.getByRole('button', { name: 'Bowling' }))

    await waitFor(() => {
      const last = callsFor('/players/rankings').at(-1)
      expect(last[1].params.type).toBe('bowling')
    })
  })

  it('passes organization-type and location filters to the team request', async () => {
    render(
      <MemoryRouter>
        <Rankings />
      </MemoryRouter>
    )
    await waitFor(() => expect(callsFor('/rankings-v2/overall').length).toBeGreaterThan(0))

    fireEvent.change(screen.getByLabelText('Organization type'), { target: { value: 'club' } })
    fireEvent.change(screen.getByLabelText('City'), { target: { value: 'Lahore' } })

    await waitFor(() => {
      const last = callsFor('/rankings-v2/overall').at(-1)
      expect(last[1].params.orgType).toBe('club')
      expect(last[1].params.city).toBe('Lahore')
    })
  })

  it('shows a clear empty state when a filter combination has no results', async () => {
    api.get.mockImplementation((url) => {
      if (url === '/rankings-v2/overall') return Promise.resolve({ data: [] })
      return Promise.resolve({ data: [] })
    })

    render(
      <MemoryRouter>
        <Rankings />
      </MemoryRouter>
    )

    await waitFor(() => expect(screen.getByText('No team rankings match these filters.')).toBeTruthy())
  })
})

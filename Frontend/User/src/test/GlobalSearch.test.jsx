import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import GlobalSearch from '../components/GlobalSearch'
import { api } from '../services/api'

vi.mock('../services/api', () => ({
  api: { get: vi.fn() },
}))

vi.mock('../../../Shared/components/SafeImage.jsx', () => ({
  default: () => null,
}))

// Task 3: the global search must keep searching across every team/organization
// type, regardless of whatever browse-page filter happens to be active.
describe('GlobalSearch (Task 3)', () => {
  beforeEach(() => {
    api.get.mockReset()
    api.get.mockImplementation((url) => {
      if (url.startsWith('/events')) return Promise.resolve({ data: [] })
      if (url.startsWith('/teams')) return Promise.resolve({ data: [] })
      return Promise.resolve({ data: { players: [] } })
    })
  })

  it('queries teams without an organization-type filter', async () => {
    render(
      <MemoryRouter>
        <GlobalSearch />
      </MemoryRouter>
    )

    fireEvent.change(screen.getByPlaceholderText(/Search schools/i), {
      target: { value: 'alpha' },
    })

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith('/teams?search=alpha')
    })

    const teamCalls = api.get.mock.calls
      .map(([url]) => url)
      .filter((url) => url.startsWith('/teams'))
    expect(teamCalls.length).toBeGreaterThan(0)
    for (const url of teamCalls) {
      expect(url).not.toMatch(/orgType|organizationType/i)
    }
  })
})

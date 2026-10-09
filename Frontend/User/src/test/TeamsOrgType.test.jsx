import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ThemeProvider } from '../context/ThemeContext'
import Teams from '../pages/Teams'
import { api } from '../services/api'

vi.mock('../services/api', () => ({
  api: { get: vi.fn() },
}))

const teams = [
  {
    _id: 't1',
    name: 'Alpha Cricket Club',
    category: 'Club',
    organization: 'Alpha Org',
    organizationRef: { _id: 'o1', name: 'Alpha Org', type: 'club' },
  },
  {
    _id: 't2',
    name: 'Beta Grammar School',
    category: 'School',
    organization: 'Beta Org',
    organizationRef: { _id: 'o2', name: 'Beta Org', type: 'school' },
  },
]

const renderTeams = () =>
  render(
    <ThemeProvider>
      <MemoryRouter>
        <Teams />
      </MemoryRouter>
    </ThemeProvider>
  )

describe('Teams organization-type filter (Task 3)', () => {
  beforeEach(() => {
    api.get.mockReset()
    api.get.mockResolvedValue({ data: teams })
  })

  it('shows an All option and derives organization types from the data', async () => {
    renderTeams()
    await screen.findByText('Alpha Cricket Club')
    const select = screen.getByLabelText('Filter by organization type')
    expect(select).toHaveValue('all')
    expect(screen.getByRole('option', { name: /All types/i })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /Club/i })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /School/i })).toBeInTheDocument()
  })

  it('filters the team list to the selected organization type', async () => {
    renderTeams()
    await screen.findByText('Alpha Cricket Club')
    expect(screen.getByText('Beta Grammar School')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Filter by organization type'), {
      target: { value: 'club' },
    })

    await waitFor(() => {
      expect(screen.getByText('Alpha Cricket Club')).toBeInTheDocument()
    })
    expect(screen.queryByText('Beta Grammar School')).not.toBeInTheDocument()
  })

  it('restores the mixed view with the All option', async () => {
    renderTeams()
    await screen.findByText('Alpha Cricket Club')
    const select = screen.getByLabelText('Filter by organization type')

    fireEvent.change(select, { target: { value: 'school' } })
    await waitFor(() => {
      expect(screen.queryByText('Alpha Cricket Club')).not.toBeInTheDocument()
    })

    fireEvent.change(select, { target: { value: 'all' } })
    await waitFor(() => {
      expect(screen.getByText('Alpha Cricket Club')).toBeInTheDocument()
      expect(screen.getByText('Beta Grammar School')).toBeInTheDocument()
    })
  })
})

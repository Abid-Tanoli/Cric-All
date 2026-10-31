import React from 'react'
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ThemeProvider } from '../context/ThemeContext'
import Header from '../components/Header'
import { resetCricketProviderStatusCache } from '../hooks/useCricketProviderStatus'

// The International entry needs BOTH the build flag and a provider configured on
// the server, so the status call is mocked instead of reaching the API.
const provider = vi.hoisted(() => ({ configured: false }))
vi.mock('../services/cricApi', () => ({
  getCricketProviderStatus: vi.fn(async () => ({ configured: provider.configured })),
}))

const renderHeader = () =>
  render(
    <ThemeProvider>
      <MemoryRouter>
        <Header user={null} hasOrg={false} onLogout={() => {}} />
      </MemoryRouter>
    </ThemeProvider>
  )

describe('Header navigation feature flags (Task 3)', () => {
  beforeEach(() => {
    provider.configured = false
    resetCricketProviderStatusCache()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('hides external-only sections by default', async () => {
    renderHeader()
    expect(screen.queryByText('International')).not.toBeInTheDocument()
    expect(screen.queryByText('Highlights')).not.toBeInTheDocument()
    expect(screen.queryByText('News')).not.toBeInTheDocument()
    // Let the provider status settle so nothing renders after the test ends.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(screen.queryByText('International')).not.toBeInTheDocument()
  })

  it('keeps platform-backed sections visible', () => {
    renderHeader()
    expect(screen.getByText('Teams')).toBeInTheDocument()
    expect(screen.getByText('Players')).toBeInTheDocument()
    expect(screen.getByText('Videos')).toBeInTheDocument()
    expect(screen.getByText('Rankings')).toBeInTheDocument()
  })

  it('restores International with VITE_SHOW_INTERNATIONAL=true and a configured provider', async () => {
    vi.stubEnv('VITE_SHOW_INTERNATIONAL', 'true')
    provider.configured = true
    renderHeader()
    expect(await screen.findByText('International')).toBeInTheDocument()
  })

  it('keeps International hidden while the status API reports no provider', async () => {
    vi.stubEnv('VITE_SHOW_INTERNATIONAL', 'true')
    provider.configured = false
    renderHeader()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(screen.queryByText('International')).not.toBeInTheDocument()
  })

  it('restores Highlights and News with their env flags', () => {
    vi.stubEnv('VITE_SHOW_HIGHLIGHTS', 'true')
    vi.stubEnv('VITE_SHOW_CRICKET_NEWS', 'true')
    renderHeader()
    expect(screen.getByText('Highlights')).toBeInTheDocument()
    expect(screen.getByText('News')).toBeInTheDocument()
  })
})

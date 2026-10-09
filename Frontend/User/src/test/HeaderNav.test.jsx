import React from 'react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ThemeProvider } from '../context/ThemeContext'
import Header from '../components/Header'

const renderHeader = () =>
  render(
    <ThemeProvider>
      <MemoryRouter>
        <Header user={null} hasOrg={false} onLogout={() => {}} />
      </MemoryRouter>
    </ThemeProvider>
  )

describe('Header navigation feature flags (Task 3)', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('hides external-only sections by default', () => {
    renderHeader()
    expect(screen.queryByText('International')).not.toBeInTheDocument()
    expect(screen.queryByText('Highlights')).not.toBeInTheDocument()
    expect(screen.queryByText('News')).not.toBeInTheDocument()
  })

  it('keeps platform-backed sections visible', () => {
    renderHeader()
    expect(screen.getByText('Teams')).toBeInTheDocument()
    expect(screen.getByText('Players')).toBeInTheDocument()
    expect(screen.getByText('Videos')).toBeInTheDocument()
    expect(screen.getByText('Rankings')).toBeInTheDocument()
  })

  it('restores International with VITE_SHOW_INTERNATIONAL=true and no code change', () => {
    vi.stubEnv('VITE_SHOW_INTERNATIONAL', 'true')
    renderHeader()
    expect(screen.getByText('International')).toBeInTheDocument()
  })

  it('restores Highlights and News with their env flags', () => {
    vi.stubEnv('VITE_SHOW_HIGHLIGHTS', 'true')
    vi.stubEnv('VITE_SHOW_CRICKET_NEWS', 'true')
    renderHeader()
    expect(screen.getByText('Highlights')).toBeInTheDocument()
    expect(screen.getByText('News')).toBeInTheDocument()
  })
})

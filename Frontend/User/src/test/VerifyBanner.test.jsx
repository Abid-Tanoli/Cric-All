import React from 'react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ThemeProvider } from '../context/ThemeContext'
import Header from '../components/Header'

const unverified = {
  name: 'Tester',
  email: 'tester@example.com',
  phone: '923001234567',
  emailVerified: false,
  phoneVerified: false,
}

const renderHeader = (user = unverified) =>
  render(
    <ThemeProvider>
      <MemoryRouter>
        <Header user={user} hasOrg={false} onLogout={() => {}} />
      </MemoryRouter>
    </ThemeProvider>
  )

const banner = () => screen.queryByText(/create organizations, teams and matches/i)

describe('Verification banner (REQUIRE_VERIFIED_ACCOUNT)', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('shows the banner for an unverified user by default', () => {
    renderHeader()
    expect(banner()).toBeInTheDocument()
  })

  it('hides the banner when VITE_REQUIRE_VERIFIED_ACCOUNT=false', () => {
    vi.stubEnv('VITE_REQUIRE_VERIFIED_ACCOUNT', 'false')
    renderHeader()
    expect(banner()).not.toBeInTheDocument()
  })

  it('keeps the banner when the flag is any value other than "false"', () => {
    vi.stubEnv('VITE_REQUIRE_VERIFIED_ACCOUNT', 'true')
    renderHeader()
    expect(banner()).toBeInTheDocument()
  })

  it('never shows the banner for a verified user', () => {
    renderHeader({ ...unverified, emailVerified: true })
    expect(banner()).not.toBeInTheDocument()
  })
})

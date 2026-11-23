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

const banner = () => screen.queryByText(/verify your email to continue/i)

describe('Verification banner (email-only gate)', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('shows the banner for an unverified user by default', () => {
    renderHeader()
    expect(banner()).toBeInTheDocument()
  })

  it('uses the exact required copy and never offers fake phone verification', () => {
    renderHeader()
    expect(banner()).toHaveTextContent('Verify your email to continue')
    expect(screen.getByRole('button', { name: /verify email/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /resend code/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /verify phone/i })).not.toBeInTheDocument()
  })

  it('still shows the banner when only a phone number is verified', () => {
    renderHeader({ ...unverified, email: '', phoneVerified: true })
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

  it('never shows the banner for an email-verified user', () => {
    renderHeader({ ...unverified, emailVerified: true })
    expect(banner()).not.toBeInTheDocument()
  })
})

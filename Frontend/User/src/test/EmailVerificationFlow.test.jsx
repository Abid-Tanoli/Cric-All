import React from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import EmailCodeForm from '../components/EmailCodeForm'

const verifyEmailCode = vi.fn()
const resendVerification = vi.fn()
const changeVerificationEmail = vi.fn()

vi.mock('../pages/auth/auth', () => ({
  verifyEmailCode: (...args) => verifyEmailCode(...args),
  resendVerification: (...args) => resendVerification(...args),
  changeVerificationEmail: (...args) => changeVerificationEmail(...args),
}))

describe('Email code entry / resend / change email', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    verifyEmailCode.mockResolvedValue({ message: 'Email verified.' })
    resendVerification.mockResolvedValue({ message: 'sent' })
    changeVerificationEmail.mockResolvedValue({ email: 'new@example.com' })
  })

  const renderForm = (props = {}) =>
    render(<EmailCodeForm email="old@example.com" {...props} />)

  it('rejects a malformed code locally and never calls the API', () => {
    renderForm()
    const input = screen.getByLabelText(/6-digit verification code/i)
    fireEvent.change(input, { target: { value: '12ab34' } })
    expect(input).toHaveValue('1234') // non-digits are stripped
    expect(screen.getByRole('button', { name: /verify email/i })).toBeDisabled()
    expect(verifyEmailCode).not.toHaveBeenCalled()
  })

  it('submits the code, refreshes the cached user, and shows the success state', async () => {
    const user = { _id: 'u1', emailVerified: true }
    verifyEmailCode.mockResolvedValue({ message: 'Verified!', user })
    const onVerified = vi.fn()
    renderForm({ onVerified })

    fireEvent.change(screen.getByLabelText(/6-digit verification code/i), { target: { value: '482913' } })
    fireEvent.click(screen.getByRole('button', { name: /verify email/i }))

    await waitFor(() => expect(verifyEmailCode).toHaveBeenCalledWith('old@example.com', '482913'))
    expect(onVerified).toHaveBeenCalledWith(user)
    expect(await screen.findByTestId('email-code-verified')).toBeInTheDocument()
    expect(screen.getByText(/can now create organizations/i)).toBeInTheDocument()
  })

  it('resends with a generic message and starts a 60s cooldown', async () => {
    renderForm()
    const button = screen.getByRole('button', { name: /resend code/i })
    fireEvent.click(button)

    await waitFor(() => expect(resendVerification).toHaveBeenCalledWith('old@example.com'))
    expect(await screen.findByText(/if that address has an unverified account/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /resend in \d+s/i })).toBeDisabled()
  })

  it('changing the email invalidates the old code view and sends to the new address', async () => {
    renderForm()
    fireEvent.click(screen.getByRole('button', { name: /change email/i }))
    fireEvent.change(screen.getByLabelText(/new email address/i), { target: { value: 'new@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: /send new code/i }))

    await waitFor(() => expect(changeVerificationEmail).toHaveBeenCalledWith('new@example.com'))
    expect(await screen.findByText(/new@example.com/)).toBeInTheDocument()
    expect(screen.getByLabelText(/6-digit verification code/i)).toHaveValue('')
    expect(screen.getByRole('button', { name: /resend in \d+s/i })).toBeDisabled()
  })
})

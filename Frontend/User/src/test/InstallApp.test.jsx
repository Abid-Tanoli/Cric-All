import React from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import InstallAppButton from '../components/InstallAppButton'
import InstallAppBanner from '../components/InstallAppBanner'
import { resetInstallPromptState } from '../pwa/installPrompt'

const INSTALL_LABEL = /install the cricall app/i

function fireBeforeInstallPrompt(outcome = 'accepted') {
  const event = new Event('beforeinstallprompt')
  event.prompt = vi.fn()
  event.userChoice = Promise.resolve({ outcome })
  act(() => {
    window.dispatchEvent(event)
  })
  return event
}

function setUserAgent(userAgent) {
  Object.defineProperty(window.navigator, 'userAgent', {
    value: userAgent,
    configurable: true,
  })
}

const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'

describe('InstallAppButton', () => {
  beforeEach(() => {
    resetInstallPromptState()
    setUserAgent(DESKTOP_UA)
    window.localStorage.clear()
  })

  it('renders nothing when the browser cannot install the app', () => {
    render(<InstallAppButton />)
    expect(screen.queryByRole('button', { name: INSTALL_LABEL })).toBeNull()
  })

  it('appears after beforeinstallprompt and calls prompt() on click', async () => {
    const event = fireBeforeInstallPrompt('accepted')
    render(<InstallAppButton />)

    const button = await screen.findByRole('button', { name: INSTALL_LABEL })
    act(() => {
      button.click()
    })

    expect(event.prompt).toHaveBeenCalledTimes(1)
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: INSTALL_LABEL })).toBeNull()
    })
  })

  it('hides itself once the app is installed', async () => {
    fireBeforeInstallPrompt()
    render(<InstallAppButton />)
    await screen.findByRole('button', { name: INSTALL_LABEL })

    act(() => {
      window.dispatchEvent(new Event('appinstalled'))
    })

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: INSTALL_LABEL })).toBeNull()
    })
  })

  it('opens Share-sheet steps on iPhone Safari, which has no install prompt', async () => {
    setUserAgent(IPHONE_UA)
    resetInstallPromptState()
    render(<InstallAppButton />)

    const button = await screen.findByRole('button', { name: INSTALL_LABEL })
    act(() => {
      button.click()
    })

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent(/Share icon/i)
    expect(dialog).toHaveTextContent(/Add to Home Screen/i)

    act(() => {
      screen.getByRole('button', { name: /got it/i }).click()
    })
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
  })
})

describe('InstallAppBanner', () => {
  beforeEach(() => {
    resetInstallPromptState()
    setUserAgent(DESKTOP_UA)
    window.localStorage.clear()
  })

  it('shows for an installable browser and remembers "Not now" for later visits', async () => {
    fireBeforeInstallPrompt()
    const { unmount } = render(<InstallAppBanner delayMs={0} />)

    const dismiss = await screen.findByRole('button', { name: /not now/i })
    act(() => {
      dismiss.click()
    })

    expect(window.localStorage.getItem('cricall:pwa-install-dismissed-at')).toBeTruthy()
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /not now/i })).toBeNull()
    })

    unmount()
    fireBeforeInstallPrompt()
    render(<InstallAppBanner delayMs={0} />)
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(screen.queryByRole('button', { name: /not now/i })).toBeNull()
  })

  it('stays hidden when the browser cannot install', async () => {
    render(<InstallAppBanner delayMs={0} />)
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(screen.queryByRole('button', { name: /not now/i })).toBeNull()
  })
})

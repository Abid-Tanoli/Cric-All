import React, { StrictMode } from 'react'
import { cleanup, render, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  push: vi.fn(),
}))

vi.mock('../components/ads/adsense', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, loadAdsense: mocks.load, pushSlot: mocks.push }
})

let AdSlot

function renderAdSlot(path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AdSlot />
    </MemoryRouter>,
  )
}

describe('AdSlot', () => {
  beforeAll(async () => {
    // Slot ids are read once when placements.js loads.
    vi.stubEnv('VITE_ADSENSE_SLOT_HOME', 'slot-home')
    vi.stubEnv('VITE_ADSENSE_SLOT_MATCH', 'slot-match')
    vi.stubEnv('VITE_ADSENSE_SLOT_TEAM', 'slot-team')
    vi.stubEnv('VITE_ADSENSE_SLOT_LIST', 'slot-list')
    AdSlot = (await import('../components/ads/AdSlot')).default
  })

  beforeEach(() => {
    window.adsbygoogle = []
    mocks.load.mockReset().mockResolvedValue(true)
    mocks.push.mockReset().mockReturnValue(true)
    vi.stubEnv('VITE_ADS_ENABLED', 'true')
    vi.stubEnv('VITE_ADSENSE_CLIENT', 'ca-pub-1234567890')
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllEnvs()
    delete window.adsbygoogle
  })

  it('renders nothing when ads are disabled or the client id is missing', () => {
    vi.stubEnv('VITE_ADS_ENABLED', 'false')
    expect(renderAdSlot().container).toBeEmptyDOMElement()

    cleanup()
    vi.stubEnv('VITE_ADS_ENABLED', 'true')
    vi.stubEnv('VITE_ADSENSE_CLIENT', '')
    expect(renderAdSlot().container).toBeEmptyDOMElement()
  })

  it('renders nothing on denylisted routes', () => {
    for (const path of [
      '/organization/org-1/matches/m-1/score/overs',
      '/organization/settings',
      '/login',
    ]) {
      expect(renderAdSlot(path).container, path).toBeEmptyDOMElement()
      cleanup()
    }
  })

  it('pushes exactly once per slot under StrictMode', async () => {
    render(
      <StrictMode>
        <MemoryRouter initialEntries={['/']}>
          <AdSlot />
        </MemoryRouter>
      </StrictMode>,
    )
    await waitFor(() => expect(mocks.push).toHaveBeenCalledTimes(1))
  })

  it('hides itself when the loader is blocked', async () => {
    mocks.load.mockResolvedValue(false)
    const { container } = renderAdSlot()
    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })
})

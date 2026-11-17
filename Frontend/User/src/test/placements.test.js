import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

async function loadPlacements() {
  vi.resetModules()
  return import('../components/ads/placements')
}

describe('ads placements', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_ADSENSE_CLIENT', 'ca-pub-1234567890')
    vi.stubEnv('VITE_ADSENSE_SLOT_HOME', 'slot-home')
    vi.stubEnv('VITE_ADSENSE_SLOT_MATCH', 'slot-match')
    vi.stubEnv('VITE_ADSENSE_SLOT_TEAM', 'slot-team')
    vi.stubEnv('VITE_ADSENSE_SLOT_LIST', 'slot-list')
  })

  afterEach(() => vi.unstubAllEnvs())

  it('allows public content pages and never exceeds two units', async () => {
    const { getPlacement, getSlotsForPath } = await loadPlacements()
    const expected = [
      ['/', 'slot-home'],
      ['/live', 'slot-list'],
      ['/match/123', 'slot-match'],
      ['/matches/123', 'slot-match'],
      ['/cricket/match/123', 'slot-match'],
      ['/international/123', 'slot-match'],
      ['/teams/42', 'slot-team'],
      ['/series/abc', 'slot-list'],
      ['/series/abc/teams', 'slot-list'],
      ['/rankings', 'slot-list'],
      ['/news', 'slot-list'],
      ['/cricket-news', 'slot-list'],
      ['/organization', 'slot-list'],
      ['/dashboard', 'slot-list'],
    ]
    for (const [path, slot] of expected) {
      expect(getPlacement(path)?.slot, path).toBe(slot)
      expect(getSlotsForPath(path).length).toBeLessThanOrEqual(2)
    }
  })

  it('denylists scoring, forms, auth, error and offline routes', async () => {
    const { getPlacement, isDenylisted } = await loadPlacements()
    const denied = [
      '/organization/org-1/matches/m-1/score/overs',
      '/match/1/setup/wizard',
      '/match/1/innings-break',
      '/organization/settings',
      '/organization/new',
      '/account',
      '/change-password',
      '/login',
      '/register',
      '/forgot-password',
      '/verify-email/token',
      '/verify-phone',
      '/404',
      '/error',
      '/offline',
    ]
    for (const path of denied) {
      expect(isDenylisted(path), path).toBe(true)
      expect(getPlacement(path), path).toBeNull()
    }
    // Unlisted routes (including 404) simply render no ad.
    expect(getPlacement('/totally-unknown-page')).toBeNull()
  })

  it('caps owner read-only pages at one unit', async () => {
    const { getPlacement } = await loadPlacements()
    expect(getPlacement('/organization')?.max).toBe(1)
    expect(getPlacement('/dashboard')?.max).toBe(1)
    expect(getPlacement('/organization')?.owner).toBe(true)
  })

  it('does not render a unit when no slot id is configured', async () => {
    vi.stubEnv('VITE_ADSENSE_SLOT_HOME', '')
    const { getPlacement } = await loadPlacements()
    expect(getPlacement('/')).toBeNull()
  })
})

import React, { useEffect, useId, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { getClientId, isAdsEnabled, isAdTestMode, loadAdsense, pushSlot } from './adsense'
import { getPlacement } from './placements'

/**
 * Responsive AdSense display unit. Renders nothing unless ads are enabled, a
 * client id + slot id are configured, and the current route is allowlisted.
 */
export default function AdSlot({ slot, className = '' }) {
  if (!isAdsEnabled()) return null
  return <EnabledAdSlot slot={slot} className={className} />
}

function EnabledAdSlot({ slot, className }) {
  const { pathname } = useLocation()
  const instanceId = useId()
  const insRef = useRef(null)
  const pushedRef = useRef(false)
  const [hidden, setHidden] = useState(false)

  const placement = getPlacement(pathname, 'inline')
  const requestedSlot = slot || placement?.slot
  const allowed =
    Boolean(placement) &&
    Boolean(requestedSlot) &&
    (!slot || placement.slot === slot) &&
    placement.max <= 2

  useEffect(() => {
    if (!allowed || hidden) return undefined
    const ins = insRef.current
    if (!ins) return undefined

    let active = true
    let observer = null
    let timer = null

    const checkFill = () => {
      if (!active) return
      if (!ins.isConnected) {
        setHidden(true)
        return
      }
      const status = ins.getAttribute('data-ad-status')
      const hasAd = status === 'filled' || ins.childElementCount > 0
      const blockStyle =
        typeof window.getComputedStyle === 'function' &&
        window.getComputedStyle(ins).display === 'none'
      if (
        status === 'unfilled' ||
        status === 'collapsed' ||
        blockStyle ||
        (timer !== null && !hasAd)
      ) {
        setHidden(true)
      }
    }

    loadAdsense().then((loaded) => {
      if (!active) return
      if (!loaded || !window.adsbygoogle) {
        setHidden(true)
        return
      }
      if (!pushedRef.current) {
        pushedRef.current = true
        // The loader also guards; this ref stops StrictMode's second effect run.
        pushSlot(`${getClientId()}:${requestedSlot}:${instanceId}`)
      }
      if (typeof MutationObserver !== 'undefined') {
        observer = new MutationObserver(checkFill)
        observer.observe(ins, { attributes: true, childList: true, subtree: true })
      }
      timer = window.setTimeout(checkFill, 4000)
    })

    return () => {
      active = false
      observer?.disconnect()
      if (timer !== null) window.clearTimeout(timer)
    }
  }, [allowed, hidden, instanceId, requestedSlot])

  if (!allowed || hidden) return null

  return (
    <div
      className={`flex justify-center ${className}`}
      style={{ marginTop: 100, marginBottom: 32 }}
      role="complementary"
      aria-label="Advertisement"
    >
      <div className="w-full max-w-[728px]">
        <p className="mb-1 text-center text-[9px] font-bold uppercase tracking-[0.2em] text-cric-muted">
          Advertisement
        </p>
        <ins
          ref={insRef}
          className="adsbygoogle block"
          style={{ display: 'block', minHeight: 120 }}
          data-ad-client={getClientId()}
          data-ad-slot={requestedSlot}
          data-ad-format="auto"
          data-full-width-responsive="true"
          data-adtest={isAdTestMode() ? 'on' : undefined}
        />
      </div>
    </div>
  )
}

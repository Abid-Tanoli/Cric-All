import { useSyncExternalStore } from 'react'
import { getInstallSnapshot, subscribeInstall } from '../pwa/installPrompt'

/** `{ canInstall, needsManualGuide, installed }` for the Admin install UI. */
export function usePwaInstall() {
  return useSyncExternalStore(subscribeInstall, getInstallSnapshot, getInstallSnapshot)
}

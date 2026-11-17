/**
 * Build-time replacement for AdSlot when VITE_ADS_ENABLED is not "true".
 * Vite aliases AdSlot to this module so no AdSense code or script URL ends up
 * in the production bundle while ads are off (the default).
 */
export default function AdSlot() {
  return null
}

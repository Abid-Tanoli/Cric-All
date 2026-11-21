import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** Defaults mirror the current manifests, so a brand.json with no keys still builds. */
export const DEFAULT_BRAND = Object.freeze({
  appName: 'CricAll',
  adminName: 'CricAll Admin',
  iconBackground: '#ffffff',
  userThemeColor: '#0a0e14',
  adminThemeColor: '#101c30',
  adminAccent: '#ff6b35',
})

/** Tests point this at a temp copy of the folder; builds use the real folder. */
export const brandingDir = process.env.CRICALL_BRANDING_DIR
  ? path.resolve(process.env.CRICALL_BRANDING_DIR)
  : path.dirname(fileURLToPath(import.meta.url))

const BRAND_KEYS = Object.keys(DEFAULT_BRAND)

export function loadBrand(dir = brandingDir) {
  let file = {}
  try {
    file = JSON.parse(readFileSync(path.join(dir, 'brand.json'), 'utf8'))
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw new Error(`brand.json is not valid JSON: ${error.message}`)
    }
  }
  const brand = { ...DEFAULT_BRAND }
  for (const key of BRAND_KEYS) {
    if (typeof file[key] === 'string' && file[key].trim()) brand[key] = file[key].trim()
  }
  return brand
}

export function isHexColor(value) {
  return /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value)
}

/** Blend two hex colours; used for the Admin icon background and offline card. */
export function mixHex(base, accent, amount) {
  const parts = [base, accent].map((color) => {
    const hex = color.slice(1)
    const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex
    return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16))
  })
  const mixed = parts[0].map((channel, i) =>
    Math.round(channel + (parts[1][i] - channel) * amount)
      .toString(16)
      .padStart(2, '0'),
  )
  return `#${mixed.join('')}`
}

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[char])
}

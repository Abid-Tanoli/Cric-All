import { existsSync } from 'node:fs'
import path from 'node:path'
import { brandingDir, isHexColor, loadBrand } from './brand-config.mjs'
import { loadSharp } from './module-loader.mjs'

export class BrandCheckError extends Error {
  constructor(message) {
    super(message)
    this.name = 'BrandCheckError'
  }
}

/** Fails with an actionable message; warns only for an extreme aspect ratio. */
export async function checkBrand({ dir = brandingDir, projectRoot }, { warn = console.warn } = {}) {
  const emblemPath = path.join(dir, 'logo-emblem.png')
  if (!existsSync(emblemPath)) {
    throw new BrandCheckError(
      `Missing required branding file: ${emblemPath}\n` +
        'Copy your transparent emblem PNG into Frontend/Shared/branding/ and keep the name logo-emblem.png.',
    )
  }

  const sharp = await loadSharp(projectRoot)
  let meta
  try {
    meta = await sharp(emblemPath).metadata()
  } catch (error) {
    throw new BrandCheckError(`Frontend/Shared/branding/logo-emblem.png is not a readable image: ${error.message}`)
  }
  if (meta.format !== 'png') {
    throw new BrandCheckError(
      `logo-emblem.png must be a PNG (found ${meta.format || 'an unknown format'}). Re-export the emblem as PNG.`,
    )
  }
  if (!meta.hasAlpha) {
    throw new BrandCheckError(
      'logo-emblem.png has no alpha channel. Export it as a transparent PNG (RGBA) — the emblem is fitted onto a coloured canvas.',
    )
  }

  const shorter = Math.min(meta.width, meta.height)
  if (!Number.isFinite(shorter) || shorter < 512) {
    throw new BrandCheckError(
      `logo-emblem.png is ${meta.width}x${meta.height}; the shorter side must be at least 512px. Supply a larger original.`,
    )
  }
  const ratio = Math.max(meta.width, meta.height) / shorter
  if (ratio > 3) {
    warn(
      `WARNING: logo-emblem.png has an extreme aspect ratio (${ratio.toFixed(2)}:1). ` +
        'It will be fitted with padding and may look small in square icons.',
    )
  }

  const brand = loadBrand(dir)
  for (const key of ['iconBackground', 'userThemeColor', 'adminThemeColor', 'adminAccent']) {
    if (!isHexColor(brand[key])) {
      throw new BrandCheckError(`brand.json: "${key}" must be a hex colour such as #ffffff (got "${brand[key]}")`)
    }
  }

  return { brand, meta, emblemPath }
}

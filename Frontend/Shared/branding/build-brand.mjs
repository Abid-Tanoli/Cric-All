import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { brandingDir, escapeHtml, mixHex } from './brand-config.mjs'
import { checkBrand } from './check-brand.mjs'
import { loadPngToIco, loadSharp } from './module-loader.mjs'

const A_PATH = 'M50 6 L94 96 H72 L63 74 H37 L28 96 H6 Z'
const round = (value) => Number(value.toFixed(2))

/** Fit an image into a square canvas with padding, preserving its aspect ratio. */
async function onSquare(sharp, source, size, padding, background) {
  const meta = await sharp(source).metadata()
  const max = size * (1 - 2 * padding)
  const scale = Math.min(max / meta.width, max / meta.height)
  const width = Math.max(1, Math.round(meta.width * scale))
  const height = Math.max(1, Math.round(meta.height * scale))
  const fitted = await sharp(source).resize(width, height, { fit: 'fill' }).png().toBuffer()
  return sharp({
    create: { width: size, height: size, channels: 4, background },
  })
    .composite([{ input: fitted, left: Math.round((size - width) / 2), top: Math.round((size - height) / 2) }])
    .png()
    .toBuffer()
}

/** Solid corner badge; the "A" is a path so no system font is needed. */
function adminBadgeSvg(size, accent, keepInsideSafeZone) {
  const r = size * (keepInsideSafeZone ? 0.11 : 0.14)
  const cx = size * (keepInsideSafeZone ? 0.78 : 0.8)
  const cy = size * (keepInsideSafeZone ? 0.22 : 0.2)
  const scale = (r * 1.25) / 100
  const x = round(cx - 50 * scale)
  const y = round(cy - 52 * scale)
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
      `<circle cx="${round(cx)}" cy="${round(cy)}" r="${round(r)}" fill="${accent}"/>` +
      `<path d="${A_PATH}" transform="translate(${x} ${y}) scale(${round(scale)})" fill="#ffffff"/>` +
      '</svg>',
  )
}

async function fitInto(sharp, source, maxWidth, maxHeight) {
  const meta = await sharp(source).metadata()
  const scale = Math.min(maxWidth / meta.width, maxHeight / meta.height, 1)
  const width = Math.max(1, Math.round(meta.width * scale))
  const height = Math.max(1, Math.round(meta.height * scale))
  return sharp(source).resize(width, height, { fit: 'fill' }).png().toBuffer()
}

export async function buildBrand({
  projectRoot,
  variant = 'user',
  publicDir = path.join(projectRoot, 'public'),
  dir = brandingDir,
  warn,
}) {
  const isAdmin = variant === 'admin'
  const { brand, emblemPath } = await checkBrand({ dir, projectRoot }, { warn })
  const sharp = await loadSharp(projectRoot)
  const pngToIco = await loadPngToIco(projectRoot)

  const iconsDir = path.join(publicDir, 'icons')
  const brandOutDir = path.join(publicDir, 'brand')
  await mkdir(iconsDir, { recursive: true })
  await mkdir(brandOutDir, { recursive: true })

  const name = isAdmin ? brand.adminName : brand.appName
  const theme = isAdmin ? brand.adminThemeColor : brand.userThemeColor
  const background = isAdmin ? mixHex(brand.iconBackground, brand.adminAccent, 0.14) : brand.iconBackground

  const renderIcon = async (size, padding, safeBadge) => {
    let png = await onSquare(sharp, emblemPath, size, padding, background)
    if (isAdmin) {
      png = await sharp(png)
        .composite([{ input: adminBadgeSvg(size, brand.adminAccent, safeBadge), left: 0, top: 0 }])
        .png()
        .toBuffer()
    }
    return png
  }

  const targets = [
    { file: 'icon-192.png', size: 192, padding: 0.12, safeBadge: false },
    { file: 'icon-512.png', size: 512, padding: 0.12, safeBadge: false },
    { file: 'icon-maskable-512.png', size: 512, padding: 0.16, safeBadge: true },
    { file: 'apple-touch-icon-180.png', size: 180, padding: 0.1, safeBadge: true },
  ]
  for (const target of targets) {
    await writeFile(path.join(iconsDir, target.file), await renderIcon(target.size, target.padding, target.safeBadge))
  }

  const faviconFrames = []
  for (const size of [16, 32, 48]) {
    const png = await renderIcon(size, size <= 16 ? 0.06 : 0.08, true)
    faviconFrames.push(png)
    if (size !== 48) await writeFile(path.join(publicDir, `favicon-${size}.png`), png)
  }
  await writeFile(path.join(publicDir, 'favicon.ico'), await pngToIco(faviconFrames))

  if (!isAdmin) {
    const fullPath = path.join(dir, 'logo-full.png')
    const socialSource = existsSync(fullPath) ? fullPath : emblemPath
    const art = await fitInto(sharp, socialSource, fullPath === socialSource ? 1000 : 440, 440)
    const artMeta = await sharp(art).metadata()
    await sharp({ create: { width: 1200, height: 630, channels: 4, background: brand.iconBackground } })
      .composite([
        {
          input: art,
          left: Math.round((1200 - artMeta.width) / 2),
          top: Math.round((630 - artMeta.height) / 2),
        },
      ])
      .png()
      .toFile(path.join(publicDir, 'social-share.png'))
  }

  await copyFile(emblemPath, path.join(brandOutDir, 'emblem.png'))
  const fullLogo = path.join(dir, 'logo-full.png')
  await copyFile(existsSync(fullLogo) ? fullLogo : emblemPath, path.join(brandOutDir, 'logo-full.png'))

  const template = await readFile(path.join(dir, 'offline.template.html'), 'utf8')
  const offline = template
    .replaceAll('__APP_NAME__', escapeHtml(name))
    .replaceAll('__THEME_COLOR__', theme)
    .replaceAll('__CARD_BG__', mixHex(theme, '#ffffff', 0.08))
    .replaceAll(
      '__OFFLINE_MESSAGE__',
      isAdmin ? 'Admin actions need internet. Reconnect and try again.' : 'Live scores need internet. Reconnect and try again.',
    )
    .replaceAll('__ROBOTS__', isAdmin ? 'noindex,nofollow' : 'noindex')
  await writeFile(path.join(publicDir, 'offline.html'), offline)

  console.log(`[brand:${variant}] wrote icons, favicons, brand assets and offline.html to ${publicDir}`)
  return { brand, background }
}

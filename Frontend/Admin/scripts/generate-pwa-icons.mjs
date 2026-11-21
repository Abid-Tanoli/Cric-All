/**
 * Regenerates the placeholder Admin PWA icons from public/icons/admin-logo.svg.
 * Replace that SVG with the real Admin mark (keep the 512x512 viewBox and the
 * `id="mark"` group), then run `npm run pwa:icons`.
 *
 * Rendering uses playwright-core (a devDependency); nothing is added to the app
 * bundle. Icons are deliberately a shield + "A", not the User app's ball mark.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(projectRoot, 'public/icons')
const svgPath = path.join(outDir, 'admin-logo.svg')
const BACKGROUND = '#101c30'

/** Maskable icons keep their content inside the central safe zone (80%). */
const TARGETS = [
  { file: 'icon-192.png', size: 192, scale: 1 },
  { file: 'icon-512.png', size: 512, scale: 1 },
  { file: 'icon-maskable-512.png', size: 512, scale: 0.72 },
  { file: 'apple-touch-icon-180.png', size: 180, scale: 0.94 },
]

function findLocalChrome() {
  const base = process.env.LOCALAPPDATA
  if (!base) return undefined
  const root = path.join(base, 'ms-playwright')
  if (!existsSync(root)) return undefined
  const candidates = []
  for (const dir of readdirSync(root)) {
    if (!dir.startsWith('chromium-')) continue
    for (const sub of ['chrome-win64/chrome.exe', 'chrome-win/chrome.exe']) {
      const exe = path.join(root, dir, sub)
      if (existsSync(exe)) candidates.push({ exe, dir })
    }
  }
  candidates.sort((a, b) => Number(b.dir.split('-')[1]) - Number(a.dir.split('-')[1]))
  return candidates[0]?.exe
}

function buildHtml(svg, size, scale) {
  const scaled =
    scale === 1
      ? svg
      : svg.replace(
          '<g id="mark">',
          `<g id="mark" transform="translate(256 256) scale(${scale}) translate(-256 -256)">`,
        )
  return `<!doctype html><html><head><meta charset="utf-8" /><style>
    html,body{margin:0;padding:0;background:${BACKGROUND};}
    svg{display:block;width:${size}px;height:${size}px;}
  </style></head><body>${scaled}</body></html>`
}

/** Minimal ICO container wrapping PNG frames (supported since Windows Vista). */
function buildIco(frames) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(frames.length, 4)
  const entries = []
  let offset = 6 + frames.length * 16
  for (const { size, png } of frames) {
    const entry = Buffer.alloc(16)
    entry.writeUInt8(size >= 256 ? 0 : size, 0)
    entry.writeUInt8(size >= 256 ? 0 : size, 1)
    entry.writeUInt16LE(1, 4)
    entry.writeUInt16LE(32, 6)
    entry.writeUInt32LE(png.length, 8)
    entry.writeUInt32LE(offset, 12)
    entries.push(entry)
    offset += png.length
  }
  return Buffer.concat([header, ...entries, ...frames.map((frame) => frame.png)])
}

const svgSource = await readFile(svgPath, 'utf8')
const executablePath = process.env.PWA_CHROME_PATH || findLocalChrome()
const browser = await chromium.launch(executablePath ? { executablePath } : {})
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 })
  const render = async (size, scale, html = buildHtml(svgSource, size, scale)) => {
    await page.setViewportSize({ width: size, height: size })
    await page.setContent(html, { waitUntil: 'load' })
    return page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: size, height: size } })
  }

  for (const target of TARGETS) {
    await writeFile(path.join(outDir, target.file), await render(target.size, target.scale))
    console.log(`wrote public/icons/${target.file} (${target.size}x${target.size})`)
  }

  const frames = []
  for (const size of [16, 32, 48]) {
    frames.push({ size, png: await render(size, 0.94) })
  }
  await writeFile(path.join(projectRoot, 'public/favicon.ico'), buildIco(frames))
  console.log('wrote public/favicon.ico (16x16, 32x32, 48x48)')
} finally {
  await browser.close()
}

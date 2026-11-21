/**
 * Local PWA smoke check for the CricAll User app.
 *
 *   npm run build
 *   node scripts/pwa-verify.mjs
 *
 * Starts `serve` on the built dist (exactly like the Docker image), then checks:
 * manifest + content type, every icon, cache headers, service worker
 * registration, that /api and /socket.io are never cached, that index.html is
 * not precached, the Install app button / iOS guide / update toast, and the
 * offline fallback page after the server is stopped.
 */
import { chromium } from 'playwright-core'
import { execSync, spawn } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const brand = JSON.parse(readFileSync(path.join(projectRoot, '../Shared/branding/brand.json'), 'utf8'))
const port = Number(process.argv[2] || 4180)
const baseUrl = `http://localhost:${port}`

function findLocalChrome() {
  if (process.env.PWA_CHROME_PATH) return process.env.PWA_CHROME_PATH
  const root = process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright')
  if (root && existsSync(root)) {
    const found = []
    for (const dir of readdirSync(root)) {
      if (!dir.startsWith('chromium-')) continue
      for (const sub of ['chrome-win64/chrome.exe', 'chrome-win/chrome.exe']) {
        const exe = path.join(root, dir, sub)
        if (existsSync(exe)) found.push({ exe, build: Number(dir.split('-')[1]) })
      }
    }
    found.sort((a, b) => b.build - a.build)
    if (found[0]) return found[0].exe
  }
  // Machines without ms-playwright can still run the check with a system browser.
  if (process.platform === 'win32') {
    return [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    ].find(existsSync)
  }
  return undefined
}

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

async function waitForServer(timeoutMs = 30000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const res = await fetch(`${baseUrl}/`)
      if (res.ok) return true
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 400))
  }
  return false
}

const serveArgs = `--yes serve@14.2.4 -s dist -l ${port}`
const server = process.platform === 'win32'
  ? spawn(`npx ${serveArgs}`, { cwd: projectRoot, shell: true, stdio: 'ignore' })
  : spawn('npx', serveArgs.split(' '), { cwd: projectRoot, stdio: 'ignore' })

let serverStopped = false
function stopServer() {
  if (serverStopped) return
  serverStopped = true
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /PID ${server.pid} /T /F`, { stdio: 'ignore' })
    } else {
      server.kill('SIGKILL')
    }
  } catch {
    /* already gone */
  }
}

const executablePath = process.env.PWA_CHROME_PATH || findLocalChrome()
let browser
try {
  if (!(await waitForServer())) throw new Error(`serve did not answer on ${baseUrl}`)

  // ── HTTP level: content types and cache headers ─────────────────────────────
  const manifestRes = await fetch(`${baseUrl}/manifest.webmanifest`)
  const manifest = await manifestRes.json()
  check(
    'manifest served as application/manifest+json',
    (manifestRes.headers.get('content-type') || '').includes('application/manifest+json'),
    manifestRes.headers.get('content-type'),
  )
  check(
    'manifest required fields',
    ['name', 'short_name', 'start_url', 'scope', 'display', 'theme_color', 'background_color'].every(
      (key) => Boolean(manifest[key]),
    ) && manifest.display === 'standalone',
  )
  check(
    'manifest has 192, 512 and maskable icons',
    ['192x192', '512x512'].every((size) => manifest.icons.some((icon) => icon.sizes === size)) &&
      manifest.icons.some((icon) => icon.purpose?.includes('maskable')),
  )
  check(
    'manifest uses brand.json names and user theme',
    manifest.name === brand.appName &&
      manifest.short_name === brand.appName &&
      manifest.theme_color === brand.userThemeColor &&
      manifest.background_color === brand.userThemeColor,
  )

  for (const src of manifest.icons.map((icon) => icon.src)) {
    const res = await fetch(`${baseUrl}${src}`)
    check(
      `icon ${src} loads as image`,
      res.ok && (res.headers.get('content-type') || '').includes('image/'),
      `${res.status}`,
    )
  }
  for (const extra of [
    '/icons/apple-touch-icon-180.png',
    '/favicon.ico',
    '/favicon-16.png',
    '/favicon-32.png',
    '/brand/emblem.png',
    '/brand/logo-full.png',
    '/social-share.png',
    '/offline.html',
  ]) {
    const res = await fetch(`${baseUrl}${extra}`)
    check(`${extra} served directly (no redirect)`, res.ok && res.redirected === false, `${res.status}`)
  }
  check(
    'offline page uses the generated emblem',
    /\/brand\/emblem\.png/.test(await (await fetch(`${baseUrl}/offline.html`)).text()),
  )

  const swRes = await fetch(`${baseUrl}/sw.js`)
  check(
    'sw.js served with no-cache',
    /no-cache|no-store/i.test(swRes.headers.get('cache-control') || ''),
    swRes.headers.get('cache-control'),
  )
  const htmlRes = await fetch(`${baseUrl}/`)
  check(
    'index.html served with no-cache',
    /no-cache|no-store/i.test(htmlRes.headers.get('cache-control') || ''),
    htmlRes.headers.get('cache-control'),
  )
  check(
    'manifest served with no-cache',
    /no-cache|no-store/i.test(manifestRes.headers.get('cache-control') || ''),
    manifestRes.headers.get('cache-control'),
  )
  const assetName = readdirSync(path.join(projectRoot, 'dist/assets')).find((file) => file.endsWith('.js'))
  const assetRes = await fetch(`${baseUrl}/assets/${assetName}`)
  check(
    'hashed assets served with immutable caching',
    /immutable/.test(assetRes.headers.get('cache-control') || ''),
    assetRes.headers.get('cache-control'),
  )

  const html = await htmlRes.text()
  check('index.html links the manifest', /rel="manifest"/.test(html))
  check(
    'index.html has iOS meta tags, theme-color and viewport-fit=cover',
    /apple-mobile-web-app-capable/.test(html) &&
      /apple-mobile-web-app-title/.test(html) &&
      /apple-touch-icon/.test(html) &&
      /name="theme-color"/.test(html) &&
      /viewport-fit=cover/.test(html),
  )
  check('SPA route falls back to index.html', /<div id="root">/.test(await (await fetch(`${baseUrl}/live`)).text()))

  // ── Browser level ──────────────────────────────────────────────────────────
  browser = await chromium.launch(executablePath ? { executablePath } : {})
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto(`${baseUrl}/`, { waitUntil: 'load' })

  const swState = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return { supported: false }
    const registration = await navigator.serviceWorker.ready
    return {
      supported: true,
      scope: registration.scope,
      active: Boolean(registration.active),
    }
  })
  check('service worker registers and activates', swState.supported && swState.active, swState.scope)
  await page.reload({ waitUntil: 'load' })
  check(
    'page is controlled by the service worker',
    await page.evaluate(() => Boolean(navigator.serviceWorker.controller)),
  )
  await page.waitForTimeout(800)

  // API + Socket.IO must never be cached.
  await page.evaluate(async () => {
    await fetch('/api/__pwa_probe__', { cache: 'no-store' }).catch(() => {})
    await fetch('/socket.io/?EIO=4', { cache: 'no-store' }).catch(() => {})
  })
  const cachedApi = await page.evaluate(async () => {
    const names = await caches.keys()
    const hits = []
    for (const name of names) {
      const cache = await caches.open(name)
      for (const request of await cache.keys()) {
        if (request.url.includes('/api/') || request.url.includes('/socket.io')) hits.push(request.url)
      }
    }
    return { names, hits }
  })
  check(
    'API and Socket.IO responses are never cached',
    cachedApi.hits.length === 0,
    `caches: ${cachedApi.names.join(', ')}`,
  )

  const precacheKeys = await page.evaluate(async () => {
    const cache = await caches.open(`workbox-precache-v2-${location.origin}/`)
    return (await cache.keys()).map((request) => new URL(request.url).pathname)
  })
  check(
    'index.html is not precached (no stale shell)',
    !precacheKeys.includes('/index.html') && !precacheKeys.includes('/'),
  )
  check('offline page is precached', precacheKeys.includes('/offline.html'))

  // Install button: simulate beforeinstallprompt, click, then appinstalled.
  const installFlow = await page.evaluate(async () => {
    const event = new Event('beforeinstallprompt')
    let prompted = 0
    event.prompt = () => {
      prompted += 1
    }
    event.userChoice = Promise.resolve({ outcome: 'dismissed' })
    window.dispatchEvent(event)
    await new Promise((resolve) => setTimeout(resolve, 80))
    const navButton = document.querySelector('button[aria-label="Install the CricAll app"]')
    const visibleBefore = Boolean(navButton)
    const entries = document.querySelectorAll('button[aria-label="Install the CricAll app"]').length
    const footerEntry = Boolean(document.querySelector('footer button[aria-label="Install the CricAll app"]'))
    navButton?.click()
    await new Promise((resolve) => setTimeout(resolve, 80))
    window.dispatchEvent(new Event('appinstalled'))
    await new Promise((resolve) => setTimeout(resolve, 80))
    const hiddenAfterInstall = !document.querySelector('button[aria-label="Install the CricAll app"]')
    return { visibleBefore, prompted, hiddenAfterInstall, entries, footerEntry }
  })
  check('Install app button appears on beforeinstallprompt', installFlow.visibleBefore)
  check('Install app button calls prompt() once', installFlow.prompted === 1)
  check('Install app button hides after install', installFlow.hiddenAfterInstall)

  check(
    'install entries render in the navbar, mobile menu and footer',
    installFlow.entries >= 2 && installFlow.footerEntry,
    `${installFlow.entries} entries, footer: ${installFlow.footerEntry}`,
  )

  // Update toast.
  const toast = await page.evaluate(async () => {
    window.dispatchEvent(new CustomEvent('cricall:pwa', { detail: { type: 'need-refresh' } }))
    await new Promise((resolve) => setTimeout(resolve, 80))
    return document.body.innerText.includes('New version available')
  })
  check('update toast shows "New version available"', toast)

  // iOS guide (Safari never fires beforeinstallprompt).
  const iosContext = await browser.newContext()
  await iosContext.addInitScript(() => {
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',
      configurable: true,
    })
  })
  const iosPage = await iosContext.newPage()
  await iosPage.goto(`${baseUrl}/`, { waitUntil: 'load' })
  const iosFlow = await iosPage.evaluate(async () => {
    const button = document.querySelector('button[aria-label="Install the CricAll app"]')
    if (!button) return { visible: false }
    button.click()
    await new Promise((resolve) => setTimeout(resolve, 100))
    const dialog = document.querySelector('[role="dialog"]')
    return { visible: true, dialog: dialog ? dialog.innerText : '' }
  })
  check(
    'iOS shows Share-sheet install steps',
    iosFlow.visible && /Add to Home Screen/i.test(iosFlow.dialog || ''),
  )
  await iosContext.close()

  // ── Offline fallback: stop the server, then open an uncached route ──────────
  await page.waitForTimeout(500)
  stopServer()
  await new Promise((resolve) => setTimeout(resolve, 800))
  const offlinePage = await context.newPage()
  let offlineBody = ''
  try {
    await offlinePage.goto(`${baseUrl}/never-visited-${Date.now()}`, {
      waitUntil: 'domcontentloaded',
      timeout: 10000,
    })
    offlineBody = await offlinePage.evaluate(() => document.body.innerText)
  } catch {
    offlineBody = ''
  }
  check(
    'offline navigation falls back to the offline page',
    /You are offline/i.test(offlineBody) && /Retry/i.test(offlineBody),
    offlineBody.replace(/\s+/g, ' ').slice(0, 60),
  )
} finally {
  if (browser) await browser.close()
  stopServer()
}

const failed = results.filter((result) => !result.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exit(failed.length === 0 ? 0 : 1)

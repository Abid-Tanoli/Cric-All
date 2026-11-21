/**
 * Local PWA smoke check for the CricAll Admin app (built dist, served exactly
 * like the Docker image):
 *
 *   npm run build
 *   npm run pwa:verify
 *
 * Checks the manifest/icons, serve headers, SPA fallback, service worker,
 * install/update UI, and the offline page after the server is stopped.
 */
import { chromium } from 'playwright-core'
import { execSync, spawn } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const port = Number(process.argv[2] || 4181)
const baseUrl = `http://localhost:${port}`

function findBrowser() {
  if (process.env.PWA_CHROME_PATH) return process.env.PWA_CHROME_PATH
  const playwrightRoot = process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright')
  if (playwrightRoot && existsSync(playwrightRoot)) {
    const found = []
    for (const dir of readdirSync(playwrightRoot)) {
      if (!dir.startsWith('chromium-')) continue
      for (const sub of ['chrome-win64/chrome.exe', 'chrome-win/chrome.exe']) {
        const exe = path.join(playwrightRoot, dir, sub)
        if (existsSync(exe)) found.push({ exe, build: Number(dir.split('-')[1]) })
      }
    }
    found.sort((a, b) => b.build - a.build)
    if (found[0]) return found[0].exe
  }
  // Local CI/developer machines without ms-playwright can still run the check.
  if (process.platform === 'win32') {
    const installed = [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    ]
    return installed.find(existsSync)
  }
  return undefined
}

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

async function waitForServer(timeoutMs = 90000) {
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
const serveEnv = { ...process.env, NO_UPDATE_NOTIFIER: '1' }
const server = process.platform === 'win32'
  ? spawn(`npx ${serveArgs}`, { cwd: projectRoot, shell: true, stdio: 'ignore', env: serveEnv })
  : spawn('npx', serveArgs.split(' '), { cwd: projectRoot, stdio: 'ignore', env: serveEnv })

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

// Sidebar (and therefore the install button) is behind ProtectedRoute. Seed a
// token so the verify run reaches the authenticated shell without a backend.
const seedAdminSession = () => {
  localStorage.setItem('token', 'pwa-verify-token')
  localStorage.setItem('bq_token', 'pwa-verify-token')
  localStorage.setItem(
    'bq_user',
    JSON.stringify({ _id: 'pwa-verify', name: 'PWA Verify', email: 'pwa@verify.test', role: 'admin' }),
  )
}

const executablePath = findBrowser()
let browser
try {
  if (!(await waitForServer())) throw new Error(`serve did not answer on ${baseUrl}`)

  // ── HTTP level ─────────────────────────────────────────────────────────────
  const manifestRes = await fetch(`${baseUrl}/manifest.webmanifest`)
  const manifest = await manifestRes.json()
  check(
    'manifest served as application/manifest+json',
    (manifestRes.headers.get('content-type') || '').includes('application/manifest+json'),
    manifestRes.headers.get('content-type'),
  )
  check(
    'Admin manifest fields (id, names, standalone, root start/scope)',
    Boolean(manifest.id) &&
      manifest.name === 'CricAll Admin' &&
      manifest.short_name === 'CricAll Admin' &&
      manifest.start_url === '/' &&
      manifest.scope === '/' &&
      manifest.display === 'standalone',
  )
  check(
    'theme/background differ from the User app',
    manifest.theme_color !== '#0a0e14' && manifest.background_color !== '#0a0e14',
    `${manifest.theme_color} / ${manifest.background_color}`,
  )
  check(
    'manifest has 192, 512 and maskable icons',
    ['192x192', '512x512'].every((size) => manifest.icons.some((icon) => icon.sizes === size)) &&
      manifest.icons.some((icon) => icon.purpose?.includes('maskable')),
  )

  for (const src of manifest.icons.map((icon) => icon.src)) {
    const res = await fetch(`${baseUrl}${src}`)
    check(
      `icon ${src} loads as image`,
      res.ok && (res.headers.get('content-type') || '').includes('image/'),
      `${res.status}`,
    )
  }
  for (const extra of ['/icons/apple-touch-icon-180.png', '/favicon.ico', '/offline.html', '/robots.txt']) {
    const res = await fetch(`${baseUrl}${extra}`)
    check(`${extra} served directly (no redirect)`, res.ok && res.redirected === false, `${res.status}`)
  }

  const robots = await (await fetch(`${baseUrl}/robots.txt`)).text()
  check('robots.txt disallows every crawler', /User-agent:\s*\*/i.test(robots) && /Disallow:\s*\//i.test(robots))

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
  for (const [header, value] of [
    ['x-content-type-options', 'nosniff'],
    ['x-frame-options', 'deny'],
    ['referrer-policy', 'same-origin'],
  ]) {
    check(
      `security header ${header}`,
      (htmlRes.headers.get(header) || '').toLowerCase().includes(value),
      htmlRes.headers.get(header),
    )
  }

  const html = await htmlRes.text()
  check('index.html links the manifest', /rel="manifest"/.test(html))
  check('index.html asks crawlers not to index', /name="robots"[^>]*noindex,nofollow/i.test(html))
  check(
    'index.html has iOS meta tags, theme-color and viewport-fit=cover',
    /apple-mobile-web-app-capable/.test(html) &&
      /apple-mobile-web-app-title/.test(html) &&
      /apple-touch-icon/.test(html) &&
      /name="theme-color"/.test(html) &&
      /viewport-fit=cover/.test(html),
  )
  check('SPA route falls back to index.html', /<div id="root">/.test(await (await fetch(`${baseUrl}/admin/live`)).text()))

  // ── Browser level ──────────────────────────────────────────────────────────
  browser = await chromium.launch(executablePath ? { executablePath } : {})
  const context = await browser.newContext()
  await context.addInitScript(seedAdminSession)
  const page = await context.newPage()
  await page.goto(`${baseUrl}/admin`, { waitUntil: 'load' })

  const swState = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return { supported: false }
    const registration = await navigator.serviceWorker.ready
    return { supported: true, scope: registration.scope, active: Boolean(registration.active) }
  })
  check('service worker registers and activates', swState.supported && swState.active, swState.scope)
  await page.reload({ waitUntil: 'load' })
  check(
    'page is controlled by the service worker',
    await page.evaluate(() => Boolean(navigator.serviceWorker.controller)),
  )
  await page.waitForTimeout(500)

  // API, Socket.IO and private uploads must never be cached.
  await page.evaluate(async () => {
    await Promise.allSettled([
      fetch('/api/__pwa_probe__', { cache: 'no-store' }),
      fetch('/socket.io/?EIO=4', { cache: 'no-store' }),
      fetch('/uploads/__pwa_probe__.png', { cache: 'no-store' }),
    ])
  })
  const cachedPrivate = await page.evaluate(async () => {
    const names = await caches.keys()
    const hits = []
    for (const name of names) {
      const cache = await caches.open(name)
      for (const request of await cache.keys()) {
        if (/\/api\/|\/socket\.io|\/uploads\//.test(request.url)) hits.push(request.url)
      }
    }
    return { names, hits }
  })
  check(
    'API, Socket.IO and uploads are never cached',
    cachedPrivate.hits.length === 0,
    `caches: ${cachedPrivate.names.join(', ')}`,
  )
  check(
    'no runtime navigation cache is created',
    !cachedPrivate.names.some((name) => /pages|runtime/i.test(name)),
    cachedPrivate.names.join(', '),
  )

  const precacheKeys = await page.evaluate(async () => {
    const cache = await caches.open(`workbox-precache-v2-${location.origin}/`)
    return (await cache.keys()).map((request) => new URL(request.url).pathname)
  })
  check(
    'index.html is not precached (no stale admin shell)',
    !precacheKeys.includes('/index.html') && !precacheKeys.includes('/'),
  )
  check('offline page is precached', precacheKeys.includes('/offline.html'))

  // Install button: simulate beforeinstallprompt, click, then appinstalled.
  const installFlow = await page.evaluate(async () => {
    const event = new Event('beforeinstallprompt')
    let prompted = 0
    event.prompt = () => { prompted += 1 }
    event.userChoice = Promise.resolve({ outcome: 'dismissed' })
    window.dispatchEvent(event)
    await new Promise((resolve) => setTimeout(resolve, 100))
    const button = document.querySelector('button[aria-label="Install the CricAll Admin app"]')
    const visibleBefore = Boolean(button)
    button?.click()
    await new Promise((resolve) => setTimeout(resolve, 100))
    window.dispatchEvent(new Event('appinstalled'))
    await new Promise((resolve) => setTimeout(resolve, 100))
    return {
      visibleBefore,
      prompted,
      hiddenAfterInstall: !document.querySelector('button[aria-label="Install the CricAll Admin app"]'),
    }
  })
  check('Install Admin app button appears on beforeinstallprompt', installFlow.visibleBefore)
  check('Install Admin app button calls prompt() once', installFlow.prompted === 1)
  check('Install Admin app button hides after install', installFlow.hiddenAfterInstall)

  // Update toast (the real registration emits the same event).
  const toast = await page.evaluate(async () => {
    window.dispatchEvent(new CustomEvent('cricall-admin:pwa', { detail: { type: 'need-refresh' } }))
    await new Promise((resolve) => setTimeout(resolve, 100))
    return document.body.innerText.includes('New version available')
  })
  check('update toast shows "New version available"', toast)

  // iOS Safari: no beforeinstallprompt, so the Share hint is shown instead.
  const iosContext = await browser.newContext()
  await iosContext.addInitScript(seedAdminSession)
  await iosContext.addInitScript(() => {
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',
      configurable: true,
    })
  })
  const iosPage = await iosContext.newPage()
  const iosErrors = []
  iosPage.on('pageerror', (error) => iosErrors.push(error.message))
  await iosPage.goto(`${baseUrl}/admin`, { waitUntil: 'load' })
  await iosPage.waitForTimeout(500)
  const iosHint = await iosPage.evaluate(() => {
    const button = document.querySelector('button[aria-label="Install the CricAll Admin app"]')
    return {
      hint: document.body.innerText.includes('Share > Add to Home Screen'),
      button: Boolean(button),
    }
  })
  check(
    'iOS shows "Share > Add to Home Screen" help (no install button)',
    iosHint.hint && !iosHint.button,
    iosErrors.join(' | ').slice(0, 120),
  )
  await iosContext.close()

  // ── Offline fallback: stop the server, then open an uncached route ─────────
  await page.waitForTimeout(400)
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

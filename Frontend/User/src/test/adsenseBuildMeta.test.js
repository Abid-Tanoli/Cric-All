// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { build } from 'vite'
import fs from 'node:fs/promises'
import os from 'node:os'
import process from 'node:process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const currentDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

async function buildIndex(client, enabled) {
  const outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cricall-adsense-'))
  const previousClient = process.env.VITE_ADSENSE_CLIENT
  const previousEnabled = process.env.VITE_ADS_ENABLED
  process.env.VITE_ADSENSE_CLIENT = client
  process.env.VITE_ADS_ENABLED = enabled
  try {
    await build({
      configFile: path.resolve(currentDir, 'vite.config.js'),
      mode: 'production',
      logLevel: 'silent',
      build: { outDir, emptyOutDir: true },
    })
    const html = await fs.readFile(path.join(outDir, 'index.html'), 'utf8')
    const assets = await fs.readdir(path.join(outDir, 'assets'))
    const js = await Promise.all(
      assets.filter((file) => file.endsWith('.js')).map((file) => fs.readFile(path.join(outDir, 'assets', file), 'utf8')),
    )
    return { html, js: js.join('\n') }
  } finally {
    if (previousClient === undefined) delete process.env.VITE_ADSENSE_CLIENT
    else process.env.VITE_ADSENSE_CLIENT = previousClient
    if (previousEnabled === undefined) delete process.env.VITE_ADS_ENABLED
    else process.env.VITE_ADS_ENABLED = previousEnabled
    await fs.rm(outDir, { recursive: true, force: true })
  }
}

describe('built AdSense verification meta', () => {
  afterEach(() => {
    delete process.env.VITE_ADSENSE_CLIENT
    delete process.env.VITE_ADS_ENABLED
  })

  it('includes the meta tag when a client id is set, even with ads off', async () => {
    const { html, js } = await buildIndex('ca-pub-8501048347195882', 'false')
    expect(html).toMatch(/<meta name="google-adsense-account" content="ca-pub-8501048347195882"\s*\/>/)
    // Ads are off: no AdSense loader reference anywhere in the built output.
    expect(js).not.toContain('adsbygoogle.js')
    expect(js).not.toContain('pagead2.googlesyndication.com')
  }, 120000)

  it('omits the meta tag when the client id is empty', async () => {
    const { html } = await buildIndex('', 'false')
    expect(html).not.toContain('google-adsense-account')
  }, 120000)
})

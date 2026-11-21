import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { buildBrand } from '../build-brand.mjs'
import { BrandCheckError, checkBrand } from '../check-brand.mjs'
import { loadSharp } from '../module-loader.mjs'

const brandingSource = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const userRoot = path.resolve(brandingSource, '../../User')
const adminRoot = path.resolve(brandingSource, '../../Admin')
const sharp = await loadSharp(userRoot)

async function tempBranding(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'cricall-brand-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const dir = path.join(root, 'branding')
  await cp(brandingSource, dir, { recursive: true })
  const userPublic = path.join(root, 'user-public')
  const adminPublic = path.join(root, 'admin-public')
  await mkdir(userPublic)
  await mkdir(adminPublic)
  return { root, dir, userPublic, adminPublic }
}

function solidPng(color, width = 600, height = 600) {
  return sharp({ create: { width, height, channels: 4, background: color } }).png().toBuffer()
}

test('the committed emblem passes brand:check', async () => {
  const { meta } = await checkBrand({ dir: brandingSource, projectRoot: userRoot })
  assert.equal(meta.format, 'png')
  assert.equal(meta.hasAlpha, true)
  assert.ok(Math.min(meta.width, meta.height) >= 512)
})

test('builds User and Admin assets; Admin icons differ from User icons', async (t) => {
  const { dir, userPublic, adminPublic } = await tempBranding(t)
  await buildBrand({ projectRoot: userRoot, variant: 'user', publicDir: userPublic, dir })

  const expected = [
    'icons/icon-192.png',
    'icons/icon-512.png',
    'icons/icon-maskable-512.png',
    'icons/apple-touch-icon-180.png',
    'favicon.ico',
    'favicon-16.png',
    'favicon-32.png',
    'brand/emblem.png',
    'brand/logo-full.png',
    'offline.html',
  ]
  for (const file of expected) {
    assert.ok((await readFile(path.join(userPublic, file))).length > 0, `missing ${file}`)
  }
  const social = await sharp(path.join(userPublic, 'social-share.png')).metadata()
  assert.deepEqual([social.width, social.height], [1200, 630])

  await buildBrand({ projectRoot: adminRoot, variant: 'admin', publicDir: adminPublic, dir })
  const userIcon = await readFile(path.join(userPublic, 'icons/icon-512.png'))
  const adminIcon = await readFile(path.join(adminPublic, 'icons/icon-512.png'))
  assert.notDeepEqual(userIcon, adminIcon, 'Admin icons must be visually distinct')
  assert.equal((await readFile(path.join(adminPublic, 'offline.html'), 'utf8')).includes('Admin actions'), true)
})

test('replacing logo-emblem.png changes the generated icons', async (t) => {
  const { dir, userPublic } = await tempBranding(t)
  await writeFile(path.join(dir, 'logo-emblem.png'), await solidPng({ r: 220, g: 30, b: 30, alpha: 1 }))
  await buildBrand({ projectRoot: userRoot, variant: 'user', publicDir: userPublic, dir })
  const before = await readFile(path.join(userPublic, 'icons/icon-512.png'))

  await writeFile(path.join(dir, 'logo-emblem.png'), await solidPng({ r: 30, g: 60, b: 220, alpha: 1 }))
  await buildBrand({ projectRoot: userRoot, variant: 'user', publicDir: userPublic, dir })
  const after = await readFile(path.join(userPublic, 'icons/icon-512.png'))
  assert.notDeepEqual(before, after)
})

test('logo-full.png falls back to the emblem when it is not supplied', async (t) => {
  const { dir, userPublic } = await tempBranding(t)
  await rm(path.join(dir, 'logo-full.png'), { force: true })
  await buildBrand({ projectRoot: userRoot, variant: 'user', publicDir: userPublic, dir })
  assert.deepEqual(
    await readFile(path.join(userPublic, 'brand/logo-full.png')),
    await readFile(path.join(dir, 'logo-emblem.png')),
  )
})

test('brand:check rejects missing, non-PNG, opaque and undersized emblems', async (t) => {
  const { dir } = await tempBranding(t)

  await rm(path.join(dir, 'logo-emblem.png'))
  await assert.rejects(checkBrand({ dir, projectRoot: userRoot }), /Missing required branding file/)

  await sharp({ create: { width: 600, height: 600, channels: 3, background: '#123456' } })
    .jpeg()
    .toFile(path.join(dir, 'logo-emblem.png'))
  await assert.rejects(checkBrand({ dir, projectRoot: userRoot }), /must be a PNG/)

  await sharp({ create: { width: 600, height: 600, channels: 3, background: '#123456' } })
    .png()
    .toFile(path.join(dir, 'logo-emblem.png'))
  await assert.rejects(checkBrand({ dir, projectRoot: userRoot }), /no alpha channel/)

  await writeFile(path.join(dir, 'logo-emblem.png'), await solidPng({ r: 0, g: 0, b: 0, alpha: 1 }, 400, 400))
  await assert.rejects(checkBrand({ dir, projectRoot: userRoot }), /shorter side must be at least 512px/)
})

test('brand:check warns but passes for an extreme aspect ratio', async (t) => {
  const { dir } = await tempBranding(t)
  await writeFile(path.join(dir, 'logo-emblem.png'), await solidPng({ r: 1, g: 2, b: 3, alpha: 1 }, 600, 3000))
  const warnings = []
  const result = await checkBrand({ dir, projectRoot: userRoot }, { warn: (message) => warnings.push(message) })
  assert.ok(result.meta.width === 600 && result.meta.height === 3000)
  assert.ok(warnings.some((message) => /extreme aspect ratio/.test(message)))
})

test('the app brand:check script exits non-zero with a clear message', async (t) => {
  const { dir } = await tempBranding(t)
  await rm(path.join(dir, 'logo-emblem.png'))
  assert.throws(
    () =>
      execFileSync(process.execPath, [path.join(userRoot, 'scripts/check-brand.mjs')], {
        env: { ...process.env, CRICALL_BRANDING_DIR: dir },
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    (error) => error.status === 1 && /Missing required branding file/.test(error.stderr),
  )
})

test('a bad hex colour in brand.json is rejected', async (t) => {
  const { dir } = await tempBranding(t)
  await writeFile(path.join(dir, 'brand.json'), JSON.stringify({ adminAccent: 'orange' }))
  await assert.rejects(checkBrand({ dir, projectRoot: userRoot }), BrandCheckError)
  await assert.rejects(checkBrand({ dir, projectRoot: userRoot }), /brand\.json: "adminAccent"/)
})

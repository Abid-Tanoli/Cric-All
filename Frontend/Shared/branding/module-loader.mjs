import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * sharp and png-to-ico are installed per app, not in Shared (Shared has no
 * package.json). Resolve them from the calling app so the same shared script
 * works inside each app's Docker layer on Windows and Linux.
 */
async function loadFromApp(projectRoot, name) {
  const require = createRequire(path.join(projectRoot, 'package.json'))
  const resolved = require.resolve(name)
  const module = await import(pathToFileURL(resolved).href)
  return module.default ?? module
}

export const loadSharp = (projectRoot) => loadFromApp(projectRoot, 'sharp')
export const loadPngToIco = (projectRoot) => loadFromApp(projectRoot, 'png-to-ico')

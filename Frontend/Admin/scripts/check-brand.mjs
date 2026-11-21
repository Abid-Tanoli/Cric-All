import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkBrand } from '../../Shared/branding/check-brand.mjs'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
try {
  await checkBrand({ projectRoot })
  console.log('Brand sources OK: logo-emblem.png is a transparent PNG, at least 512px.')
} catch (error) {
  console.error(error.message)
  process.exit(1)
}

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildBrand } from '../../Shared/branding/build-brand.mjs'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
await buildBrand({ projectRoot, variant: 'user' })

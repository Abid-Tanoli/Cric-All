import { brandingDir, loadBrand } from './brand-config.mjs'

/** Keeps the HTML meta values in sync with brand.json without touching the title. */
export function brandHtmlPlugin(variant) {
  return {
    name: 'cricall-brand-html',
    transformIndexHtml(html) {
      const brand = loadBrand(brandingDir)
      const theme = variant === 'admin' ? brand.adminThemeColor : brand.userThemeColor
      const name = variant === 'admin' ? brand.adminName : brand.appName
      return html
        .replace(/(<meta\s+name="theme-color"\s+content=")[^"]*(")/i, `$1${theme}$2`)
        .replace(/(<meta\s+name="apple-mobile-web-app-title"\s+content=")[^"]*(")/i, `$1${name}$2`)
    },
  }
}

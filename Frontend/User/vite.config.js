import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'
import { loadBrand } from '../Shared/branding/brand-config.mjs'
import { brandHtmlPlugin } from '../Shared/branding/vite-plugin.mjs'

// Keep %VITE_ADSENSE_CLIENT% in index.html defined (as an empty string) when a
// build has no client id, so Vite does not emit an "undefined env" warning.
if (process.env.VITE_ADSENSE_CLIENT === undefined) process.env.VITE_ADSENSE_CLIENT = ''

const currentDir = path.dirname(fileURLToPath(import.meta.url))
const adsenseStub = path.resolve(currentDir, 'src/components/ads/AdSlot.disabled.jsx')
const brand = loadBrand()

// The verification meta tag must be in the built HTML whenever a client id is
// set, even when ads are disabled. Vite replaces %VITE_ADSENSE_CLIENT% in
// index.html; this plugin only removes the line when the value is empty so no
// half-empty verification tag is shipped.
function adsenseVerificationMeta(clientId) {
  return {
    name: 'adsense-verification-meta',
    enforce: 'pre',
    transformIndexHtml(html) {
      if (!/^ca-pub-\d+$/.test((clientId || '').trim())) {
        return html.replace(/^[ \t]*<meta name="google-adsense-account"[^\n]*\n?/m, '')
      }
      return html
    },
  }
}

// Default-off builds contain no AdSense code at all: every AdSlot import is
// resolved to a null component, so no ad script URL is present in dist/assets.
function adsenseDisabledBuild(enabled) {
  if (enabled) return null
  return {
    name: 'adsense-disabled-build',
    enforce: 'pre',
    resolveId(id) {
      if (/(^|\/)ads\/AdSlot(\.jsx)?$/.test(id)) return adsenseStub
      return null
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, currentDir, 'VITE_')

  return {
    plugins: [
      brandHtmlPlugin('user'),
      adsenseVerificationMeta(env.VITE_ADSENSE_CLIENT),
      adsenseDisabledBuild(env.VITE_ADS_ENABLED === 'true'),
      react(),
      tailwindcss(),
      VitePWA({
        // Custom service worker (src/sw.js): navigations are NetworkFirst and
        // nothing under /api or /socket.io is ever cached, which is what fixes
        // the "users kept seeing the previous deploy" problem.
        strategies: 'injectManifest',
        srcDir: 'src',
        filename: 'sw.js',
        // A new deploy installs a waiting worker; the app shows
        // "New version available. Reload" and activates it on demand.
        registerType: 'prompt',
        // Registration lives in src/pwa/registerPwa.js so the UI can react to it
        // (update toast, update() on focus) instead of the injected script.
        injectRegister: false,
        manifest: {
          id: '/',
          name: brand.appName,
          short_name: brand.appName,
          description:
            'CricAll — live cricket scores, scorecards, series, teams and rankings.',
          lang: 'en',
          dir: 'auto',
          start_url: '/',
          scope: '/',
          display: 'standalone',
          orientation: 'any',
          // Dark navy with the orange CricAll accent (Frontend/Shared/styles/theme.css).
          theme_color: brand.userThemeColor,
          background_color: brand.userThemeColor,
          categories: ['sports', 'news'],
          icons: [
            { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
            { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
            {
              src: '/icons/icon-maskable-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
          shortcuts: [
            {
              name: 'Live Scores',
              short_name: 'Live',
              url: '/live',
              icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
            },
            {
              name: 'Matches',
              short_name: 'Matches',
              url: '/',
              icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
            },
          ],
        },
        injectManifest: {
          // index.html is deliberately NOT precached: the page shell always comes
          // from the network first, so a deploy is visible immediately.
          globPatterns: ['**/*.{js,css,svg,png,ico,webmanifest}', 'offline.html'],
          globIgnores: ['**/*.map'],
        },
      }),
    ],
    resolve: {
      alias: {
        '@shared': path.resolve(currentDir, '../Shared'),
        react: path.resolve(currentDir, 'node_modules/react'),
        'react-dom': path.resolve(currentDir, 'node_modules/react-dom'),
        'react-hook-form': path.resolve(currentDir, 'node_modules/react-hook-form'),
        '@hookform/resolvers': path.resolve(currentDir, 'node_modules/@hookform/resolvers'),
        zod: path.resolve(currentDir, 'node_modules/zod'),
        axios: path.resolve(currentDir, 'node_modules/axios'),
        'socket.io-client': path.resolve(currentDir, 'node_modules/socket.io-client'),
      },
    },
    server: {
      host: 'localhost',
      port: 5173,
      strictPort: true,
      fs: {
        allow: ['..'],
      },
      proxy: {
        '/api': {
          target: 'http://localhost:5000',
          changeOrigin: true,
        },
        '/socket.io': {
          target: 'http://localhost:5000',
          ws: true,
          changeOrigin: true,
        },
      },
    },
  }
})

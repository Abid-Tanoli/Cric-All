import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'
import { fileURLToPath } from 'node:url'

const currentDir = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': path.resolve(currentDir, '../Shared'),
      // Shared/ lives outside this package, so on a clean CI install (no
      // node_modules next to Frontend/Shared) the bare `react` / `react-dom`
      // imports inside Shared .jsx files cannot resolve. Point them at this
      // package's copies, exactly like vite.config.js does for the build.
      // `react/jsx-dev-runtime` (injected by @vitejs/plugin-react in test mode)
      // is covered because Vite matches this prefix before the subpath.
      react: path.resolve(currentDir, 'node_modules/react'),
      'react-dom': path.resolve(currentDir, 'node_modules/react-dom'),
      'socket.io-client': path.resolve(currentDir, 'node_modules/socket.io-client'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.js'],
  },
})

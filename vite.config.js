// vite.config.js
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

// ESM-safe root dir (no process.cwd())
const __filename = fileURLToPath(import.meta.url)
const __dirname  = dirname(__filename)
const ROOT       = __dirname

export default defineConfig(({ mode }) => {
  // Load .env files for the current mode from ROOT
  const env = loadEnv(mode, ROOT, '')

  // Defaults if not provided
  const host = env.VITE_BACKEND_HOST || 'localhost'
  const port = env.VITE_BACKEND_PORT || '8088'
  const httpProto = (env.VITE_BACKEND_PROTO || 'http').toLowerCase()   // http|https
  const wsProto   = (env.VITE_BACKEND_WS_PROTO || (httpProto === 'https' ? 'wss' : 'ws')).toLowerCase()

  const httpTarget = `${httpProto}://${host}:${port}`
  const wsTarget   = `${wsProto}://${host}:${port}`

  return {
    plugins: [react()],
    server: {
      proxy: {
        // Your app should connect to /ws (relative). Vite forwards to backend.
        '/ws': {
          target: wsTarget,
          ws: true,
          changeOrigin: true,
        },
        // And /api/* → backend HTTP
        '/api': {
          target: httpTarget,
          changeOrigin: true,
        },
      },
    },
  }
})
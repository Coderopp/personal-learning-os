import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// In dev, `npm run dev` runs Vite on 5173 and proxies /api to `wrangler pages dev` on 8788.
export default defineConfig({
  plugins: [react()],
  server: { host: true, proxy: { '/api': 'http://127.0.0.1:8788' } },
})

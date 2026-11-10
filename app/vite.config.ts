import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  // GitHub Pages serves the site from /degenwild/; local dev stays at /.
  base: process.env.PAGES ? '/degenwild/' : '/',
  // The Codama-generated client reads process.env.NODE_ENV, which browsers don't have.
  define: { 'process.env.NODE_ENV': JSON.stringify(mode === 'production' ? 'production' : 'development') },
}))

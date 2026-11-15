import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode, command }) => {
  // Safety: a production build must never bake a private RPC key into the public JS (.env.local has one for dev).
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  if (command === 'build' && /api[-_]?key=/i.test(env.VITE_RPC_URL ?? '') && !process.env.ALLOW_RPC_KEY_IN_BUILD)
    throw new Error('VITE_RPC_URL contains an API key; refusing to build. Unset it (e.g. VITE_RPC_URL= npm run build).');
  return {
  plugins: [react()],
  // GitHub Pages serves the site from /degenwild/; local dev stays at /.
  base: process.env.PAGES ? '/degenwild/' : '/',
  // The Codama-generated client reads process.env.NODE_ENV, which browsers don't have.
  define: { 'process.env.NODE_ENV': JSON.stringify(mode === 'production' ? 'production' : 'development') },
}
})

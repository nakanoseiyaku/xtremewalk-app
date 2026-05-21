import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
// `--mode native` (Capacitor builds) needs relative asset paths because the
// WebView serves from the app root; the web/PWA build keeps the GitHub Pages subpath.
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: mode === 'native' ? './' : '/xtremewalk-app/',
}))

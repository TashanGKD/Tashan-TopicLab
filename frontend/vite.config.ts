import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: '/topic-lab/',
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/topic-lab/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/topic-lab\/api/, '')
      }
    }
  }
})

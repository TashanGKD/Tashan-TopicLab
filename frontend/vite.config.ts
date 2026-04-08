import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

/** Browser calls `${base}api/admin/*`; topiclab-backend serves `/admin/*`. */
function adminApiProxyPrefix(viteBasePath: string): string {
  const withSlash = viteBasePath.endsWith('/') ? viteBasePath : `${viteBasePath}/`
  return `${withSlash}api/admin`.replace(/\/{2,}/g, '/')
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const base = env.VITE_BASE_PATH || '/'
  const adminPrefix = adminApiProxyPrefix(base)
  const adminPrefixRe = new RegExp(
    `^${adminPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
  )

  return {
    base,
    plugins: [react()],
    test: {
      environment: 'jsdom',
      setupFiles: './src/test/setup.ts',
    },
    server: {
      port: 3000,
      proxy: {
        // Must be before `/api` -> Resonnet; admin lives on topiclab-backend :8001
        [adminPrefix]: {
          target: 'http://127.0.0.1:8001',
          changeOrigin: true,
          rewrite: (path) => path.replace(adminPrefixRe, '/admin'),
        },
        '/api/auth': {
          target: 'http://127.0.0.1:8001',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ''),
        },
        '/api/source-feed': {
          target: 'http://127.0.0.1:8001',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ''),
        },
        '/api': {
          target: 'http://127.0.0.1:8000',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ''),
        },
      },
    },
  }
})

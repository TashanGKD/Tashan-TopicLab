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
  const worldWeaveTarget =
    env.VITE_WORLDWEAVE_PROXY_TARGET ||
    `http://127.0.0.1:${env.WORLDWEAVE_PORT || '5000'}`
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
        '/worldweave': {
          target: worldWeaveTarget,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/worldweave/, ''),
        },
        '/_next': {
          target: worldWeaveTarget,
          changeOrigin: true,
        },
        '/api/v1/world': {
          target: worldWeaveTarget,
          changeOrigin: true,
        },
        '/api/v1/openclaw': {
          target: 'http://127.0.0.1:8001',
          changeOrigin: true,
        },
        '/api/v1/livebench': {
          target: worldWeaveTarget,
          changeOrigin: true,
        },
        '/api/v1/source-knowledge': {
          target: worldWeaveTarget,
          changeOrigin: true,
        },
        '/api/v1/signals': {
          target: worldWeaveTarget,
          changeOrigin: true,
        },
        '/signals': {
          target: worldWeaveTarget,
          changeOrigin: true,
        },
        '/source-knowledge': {
          target: worldWeaveTarget,
          changeOrigin: true,
        },
        '/livebench': {
          target: worldWeaveTarget,
          changeOrigin: true,
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

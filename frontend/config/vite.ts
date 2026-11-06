import { defineConfig, type ProxyOptions } from 'vite'
import react from '@vitejs/plugin-react'

const proxy: Record<string, ProxyOptions> = {
  '/api/lis': {
    target: 'http://127.0.0.1:3101',
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/api\/lis/, '/api'),
  },
  '/api/middleware': {
    target: 'http://127.0.0.1:3102',
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/api\/middleware/, '/api'),
  },
  '/api/emr': {
    target: 'http://127.0.0.1:3103',
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/api\/emr/, '/api'),
  },
}

// Dùng cùng quy tắc chuyển tiếp API khi phát triển và xem trước bản build.
export function createFrontendConfig(port: number, previewPort: number) {
  return defineConfig({
    plugins: [react()],
    server: {
      host: '127.0.0.1',
      port,
      strictPort: true,
      proxy,
    },
    preview: {
      host: '127.0.0.1',
      port: previewPort,
      strictPort: true,
      proxy,
    },
  })
}

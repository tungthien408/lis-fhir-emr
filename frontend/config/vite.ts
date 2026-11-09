import { defineConfig, type ProxyOptions } from 'vite'
import react from '@vitejs/plugin-react'
import { withDotResultProxy } from '../apps/lis/proxy/lis.ts'

const proxy: Record<string, ProxyOptions> = {
  '/status/lis': { target: 'http://127.0.0.1:3101', rewrite: path => path.replace(/^\/status\/lis/, '') },
  '/status/middleware': { target: 'http://127.0.0.1:3102', rewrite: path => path.replace(/^\/status\/middleware/, '') },
  '/status/emr': { target: 'http://127.0.0.1:3103', rewrite: path => path.replace(/^\/status\/emr/, '') },
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

proxy['/api/lis'] = withDotResultProxy(proxy['/api/lis'])

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

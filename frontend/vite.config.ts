
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],

  server: {
    proxy: {
      '/api/lis': {
        target: 'http://127.0.0.1:3101',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/lis/, '/api'),
      },

      '/api/middleware': {
        target: 'http://127.0.0.1:3102',
        changeOrigin: true,
        rewrite: (path) =>
          path.replace(/^\/api\/middleware/, '/api'),
      },

      '/api/emr': {
        target: 'http://127.0.0.1:3103',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/emr/, '/api'),
      },
    },
  },
})

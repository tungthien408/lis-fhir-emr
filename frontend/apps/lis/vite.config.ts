import { createFrontendConfig } from '../../config/vite.ts'
import { withDotResultProxy } from './proxy/lis.ts'

const config = createFrontendConfig(5173, 4173)
const serverProxy = config.server?.proxy?.['/api/lis']
const previewProxy = config.preview?.proxy?.['/api/lis']
if (!serverProxy || typeof serverProxy === 'string' || !previewProxy || typeof previewProxy === 'string') {
  throw new Error('The LIS proxy must have explicit options for development and preview.')
}

export default {
  ...config,
  server: {
    ...config.server,
    proxy: { ...config.server?.proxy, '/api/lis': withDotResultProxy(serverProxy) },
  },
  preview: {
    ...config.preview,
    proxy: { ...config.preview?.proxy, '/api/lis': withDotResultProxy(previewProxy) },
  },
}

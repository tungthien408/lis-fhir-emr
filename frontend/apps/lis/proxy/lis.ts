import type { IncomingMessage } from 'node:http'
import type { ProxyOptions } from 'vite'
import { DOT_SEGMENT_HEADER } from '../src/api/resultRequest.ts'

export function withDotResultProxy(base: ProxyOptions): ProxyOptions {
  const varyRequests = new WeakSet<IncomingMessage>()
  return {
    ...base,
    // Skip the proxy URL parser: it would normalize %2E again.
    toProxy: true,
    bypass(req, res, options) {
      const marker = req.headers[DOT_SEGMENT_HEADER.toLowerCase()]
      delete req.headers[DOT_SEGMENT_HEADER.toLowerCase()]
      const match = /^\/api\/lis\/results\/(%252E(?:%252E)?)(\/(?:publish|publish-event))?(\?.*)?$/i.exec(req.url ?? '')
      if (match && ((req.method === 'GET' && (!match[2] || match[2] === '/publish-event'))
        || (req.method === 'POST' && match[2] === '/publish'))) {
        varyRequests.add(req)
        if (marker === '1') req.url = '/api/lis/results/' + match[1].replace(/%25/gi, '%') + (match[2] ?? '') + (match[3] ?? '')
      }
      return base.bypass?.(req, res, options)
    },
    configure(proxy, options) {
      base.configure?.(proxy, options)
      proxy.on('proxyRes', (response, req) => {
        if (!varyRequests.has(req)) return
        const values = String(response.headers.vary ?? '').split(',').map((v) => v.trim()).filter(Boolean)
        if (!values.some((v) => v === '*' || v.toLowerCase() === DOT_SEGMENT_HEADER.toLowerCase())) {
          response.headers.vary = [...values, DOT_SEGMENT_HEADER].join(', ')
        }
      })
    },
  }
}

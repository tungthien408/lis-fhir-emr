export const DOT_SEGMENT_HEADER = 'X-LIS-Dot-Segment'

export function lisResultRequest(resultId: string, action?: 'publish' | 'publish-event'): { path: string; headers?: Record<string, string> } {
  const dot = resultId === '.' || resultId === '..'
  return {
    path: '/api/lis/results/' + (dot ? resultId.replaceAll('.', '%252E') : encodeURIComponent(resultId)) + (action ? '/' + action : ''),
    ...(dot ? { headers: { [DOT_SEGMENT_HEADER]: '1' } } : {}),
  }
}

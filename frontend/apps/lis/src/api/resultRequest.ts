export const DOT_SEGMENT_HEADER = 'X-LIS-Dot-Segment'

export function lisResultRequest(resultId: string): { path: string; headers?: Record<string, string> } {
  const dot = resultId === '.' || resultId === '..'
  return {
    path: '/api/lis/results/' + (dot ? resultId.replaceAll('.', '%252E') : encodeURIComponent(resultId)),
    ...(dot ? { headers: { [DOT_SEGMENT_HEADER]: '1' } } : {}),
  }
}

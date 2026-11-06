import type { ReactNode } from 'react'
import type { Status } from '../types/exchange.ts'
import { statusLabels } from '../state/presentation.ts'
export function Badge({ status }: { status: Status }) { return <span className={'badge badge-' + status.toLowerCase()} title={status}>{statusLabels[status]} <small>{status}</small></span> }
export function Timestamp({ value }: { value: string | null }) { return value === null ? <>—</> : <time dateTime={value} title={value}>{new Date(value).toISOString().slice(0, 19).replace('T', ' ')} <small>UTC</small></time> }
export function Fact({ label, children }: { label: string; children: ReactNode }) { return <div><dt>{label}</dt><dd>{children ?? '—'}</dd></div> }
export function Feedback({ error, loading, retry }: { error: string | null; loading: boolean; retry: () => void }) {
  return loading ? <p className="feedback" role="status">Đang tải dữ liệu…</p> : error ? <div className="feedback error" role="alert"><p>{error}</p><button onClick={retry}>Thử tải lại</button></div> : null
}

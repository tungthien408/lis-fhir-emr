interface Props {
  pageIndex: number
  loading: boolean
  hasNext: boolean
  onPrevious: () => void
  onNext: () => void
}

export function ResultsPagination({ pageIndex, loading, hasNext, onPrevious, onNext }: Props) {
  return (
    <nav className="results-pagination" aria-label="Phân trang kết quả xét nghiệm">
      <p>Trang {pageIndex + 1}</p>
      <div className="pagination-actions">
        <button type="button" onClick={onPrevious} disabled={loading || pageIndex === 0}>
          Trang trước
        </button>
        <button type="button" onClick={onNext} disabled={loading || !hasNext}>
          Trang sau
        </button>
      </div>
    </nav>
  )
}

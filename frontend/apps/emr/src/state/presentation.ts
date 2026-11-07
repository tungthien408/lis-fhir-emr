/** Presentation only: keep the API label intact for technical reference. */
export function patientLabel(value: string | null) {
  const match = value?.match(/^Demo patient ([0-9]+)$/)
  return match && match[0] === value ? `Hồ sơ bệnh nhân ${match[1]}` : value
}

/** Tiêu đề trang hồ sơ; không lặp lại cụm "Hồ sơ bệnh nhân" khi nhãn đã chứa sẵn. */
export function profileTitle(label: string | null) {
  const text = patientLabel(label) || 'Chưa có nhãn hiển thị'
  return text.startsWith('Hồ sơ bệnh nhân') ? text : `Hồ sơ bệnh nhân – ${text}`
}

/** Presentation only: original UTC string remains the authoritative value. */
export function readableUtc(value: string) {
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?Z$/.exec(value)
  return parts ? `${parts[1]}-${parts[2]}-${parts[3]} ${parts[4]}:${parts[5]}:${parts[6]} UTC` : value
}


export const uuid = /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i
export const identifier = (v: string) => !!v.trim() && !Array.from(v).some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)
export function normalizeInput(value: string, kind: 'patient' | 'result') {
  const trimmed = value.trim(), pattern = kind === 'patient' ? /^MIMIC-P-[0-9]+$/i : /^MIMIC-LAB-[0-9]+$/i
  return pattern.test(trimmed) ? trimmed.toUpperCase() : trimmed
}

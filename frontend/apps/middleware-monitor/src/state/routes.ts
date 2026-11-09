
export const uuid = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i
export function identifier(v: string) { return v.trim().length > 0 && !Array.from(v).some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127) }
// Normalize search input only; never rewrite exchange identities returned by the API.
export function normalizeSourceResultId(input: string) {
  const value = input.trim()
  return /^MIMIC-LAB-[0-9]+$/i.test(value) ? value.toUpperCase() : value
}

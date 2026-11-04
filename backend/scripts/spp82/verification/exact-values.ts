/** Independent evaluator arithmetic. No production Mapper/read-back imports. */
export function decimalKey(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 4096) return undefined;
  const match = /^([+-]?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(value);
  if (!match) return undefined;
  let digits = (match[2] + (match[3] ?? '')).replace(/^0+/, '');
  if (!digits) return '0';
  let power = BigInt(match[4] ?? '0') - BigInt((match[3] ?? '').length);
  while (digits.endsWith('0')) { digits = digits.slice(0, -1); power++; }
  return `${match[1] === '-' ? '-' : ''}${digits}e${power}`;
}
export const equalDecimal = (a: unknown, b: unknown): boolean => decimalKey(a) !== undefined && decimalKey(a) === decimalKey(b);

/** Gregorian ordinal seconds + arbitrary fractional precision; never converts via Date. */
export function instantKey(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 128) return undefined;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!m) return undefined;
  const [y, month, day, hour, minute, second] = m.slice(1, 7).map(Number);
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (y < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1] || hour > 23 || minute > 59 || second > 59) return undefined;
  const zone = m[8]; const offsetHour = zone === 'Z' ? 0 : Number(zone.slice(1, 3));
  const offsetMinute = zone === 'Z' ? 0 : Number(zone.slice(4, 6));
  if (offsetHour > 14 || offsetMinute > 59 || (offsetHour === 14 && offsetMinute !== 0)) return undefined;
  const previousYear = y - 1;
  const ordinal = previousYear * 365 + Math.floor(previousYear / 4) - Math.floor(previousYear / 100)
    + Math.floor(previousYear / 400) + days.slice(0, month - 1).reduce((sum, n) => sum + n, 0) + day - 1;
  const offset = (zone.startsWith('-') ? -1 : 1) * (offsetHour * 3600 + offsetMinute * 60);
  const seconds = BigInt(ordinal) * 86400n + BigInt(hour * 3600 + minute * 60 + second - offset);
  return `${seconds}:${(m[7] ?? '').replace(/0+$/, '')}`;
}
export const equalInstant = (a: unknown, b: unknown): boolean => instantKey(a) !== undefined && instantKey(a) === instantKey(b);
export const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
export const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
export const equalUuid = (a: unknown, b: unknown): boolean => uuid(a) && uuid(b) && a.toLowerCase() === b.toLowerCase();
export class ExactNumber {
  constructor(readonly lexeme: string) {}
  toJSON() { return { json_number: this.lexeme }; }
}
/** Parse persisted JSON TEXT with exact number tokens, rejecting duplicate keys. */
export function parseExactJson(text: string): unknown {
  if (text.length > 4 * 1024 * 1024) throw new Error('FHIR_JSON_TOO_LARGE');
  let offset = 0;
  const space = () => { while (/[\t\n\r ]/.test(text[offset] ?? 'x')) offset++; };
  const fail = (): never => { throw new Error('INVALID_EXACT_JSON'); };
  function string(): string {
    const start = offset++; let escaped = false;
    while (offset < text.length) {
      const c = text[offset++];
      if (c === '"' && !escaped) return JSON.parse(text.slice(start, offset)) as string;
      if (c === '\\' && !escaped) escaped = true; else escaped = false;
    }
    return fail();
  }
  function value(depth: number): unknown {
    if (depth > 64) return fail(); space(); const c = text[offset];
    if (c === '"') return string();
    if (c === '[') {
      offset++; space(); const result: unknown[] = [];
      if (text[offset] === ']') { offset++; return result; }
      while (true) { result.push(value(depth + 1)); space(); const delimiter = text[offset++];
        if (delimiter === ']') return result; if (delimiter !== ',') return fail(); }
    }
    if (c === '{') {
      offset++; space(); const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
      if (text[offset] === '}') { offset++; return result; }
      while (true) {
        space(); if (text[offset] !== '"') return fail(); const key = string();
        if (Object.hasOwn(result, key)) return fail(); space(); if (text[offset++] !== ':') return fail();
        result[key] = value(depth + 1); space(); const delimiter = text[offset++];
        if (delimiter === '}') return result; if (delimiter !== ',') return fail();
      }
    }
    for (const [literal, parsed] of [['null', null], ['true', true], ['false', false]] as const) {
      if (text.startsWith(literal, offset)) { offset += literal.length; return parsed; }
    }
    const number = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(offset));
    if (!number) return fail(); offset += number[0].length; return new ExactNumber(number[0]);
  }
  const result = value(0); space(); if (offset !== text.length) fail(); return result;
}
export function equalTree(expected: unknown, actual: unknown, key = ''): boolean {
  if (expected instanceof ExactNumber) return actual instanceof ExactNumber && equalDecimal(expected.lexeme, actual.lexeme);
  if (key === 'effectiveDateTime') return equalInstant(expected, actual);
  if (Array.isArray(expected)) return Array.isArray(actual) && expected.length === actual.length && expected.every((v, i) => equalTree(v, actual[i]));
  if (object(expected)) return object(actual) && !(actual instanceof ExactNumber)
    && Object.keys(expected).length === Object.keys(actual).length
    && Object.keys(expected).every((name) => Object.hasOwn(actual, name) && equalTree(expected[name], actual[name], name));
  return expected === actual;
}
export function path(value: unknown, dotted: string): unknown {
  return dotted.split('.').reduce<unknown>((current, key) => object(current) || Array.isArray(current)
    ? (current as Record<string, unknown>)[key] : undefined, value);
}

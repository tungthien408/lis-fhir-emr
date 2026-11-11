

export function isLisIdentifier(value: string): boolean {
  // Chỉ kiểm tra; không trim, đổi hoa/thường hoặc chuẩn hóa định danh.
  return value.trim().length > 0 && ![...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
}

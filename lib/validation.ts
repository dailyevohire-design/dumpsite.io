/**
 * Strip HTML tags, null bytes, script tags, trim whitespace
 */
export function sanitizeText(input: string): string {
  if (typeof input !== 'string') return ''
  return input
    .replace(/\0/g, '')                          // null bytes
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '') // script tags
    .replace(/<[^>]*>/g, '')                      // all HTML tags
    .trim()
}

/**
 * Validate phone: must be 10-11 digits after stripping non-numeric
 */
export function validatePhone(phone: string): boolean {
  if (typeof phone !== 'string') return false
  const digits = phone.replace(/\D/g, '')
  return digits.length === 10 || digits.length === 11
}

/**
 * Basic email format check
 */
export function validateEmail(email: string): boolean {
  if (typeof email !== 'string') return false
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
}

/**
 * URL must start with https://
 */
export function validateUrl(url: string): boolean {
  if (typeof url !== 'string') return false
  return url.startsWith('https://')
}

/**
 * Sanitize and clamp a number to min/max range
 */
export function sanitizeNumber(input: any, min: number, max: number): number | null {
  const n = typeof input === 'number' ? input : parseInt(String(input))
  if (isNaN(n)) return null
  if (n < min || n > max) return null
  return n
}

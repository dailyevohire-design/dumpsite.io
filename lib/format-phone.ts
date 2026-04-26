// Display formatter for US phone numbers stored as 10-digit strings
// (per the conversations / customer_conversations schema, no +1 prefix).
// Returns "(XXX) XXX-XXXX" when the input normalizes to exactly 10 digits;
// otherwise returns the original input unchanged so callers can fall back.

export function formatPhone(phone: string | null | undefined): string {
  if (!phone) return ""
  const digits = phone.replace(/\D/g, "")
  const ten = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits
  if (ten.length !== 10) return phone
  return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`
}

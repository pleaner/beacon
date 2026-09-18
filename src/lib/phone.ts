// Phones are stored in E.164 form (+27821234567). Forms send a country code and a national
// number; the JSON API may send either that pair or a full number.

export function normalizePhone(number: string | null, country: string | null = '27'): string | null {
  if (!number) return null
  const trimmed = number.trim()
  if (!trimmed) return null
  const digits = trimmed.replace(/\D/g, '')
  if (!digits) return null
  if (trimmed.startsWith('+')) return '+' + digits
  if (digits.startsWith('00')) return '+' + digits.slice(2)
  const cc = (country ?? '27').replace(/\D/g, '') || '27'
  if (digits.startsWith(cc) && digits.length > cc.length + 8) return '+' + digits
  return '+' + cc + digits.replace(/^0+/, '')
}

// Splits a stored number back into a known country code and the rest, for pre-filling forms.
export function splitPhone(e164: string | null | undefined, codes: readonly { code: string }[]): { country: string; national: string } {
  if (!e164) return { country: '27', national: '' }
  if (!e164.startsWith('+')) return { country: '27', national: e164 }
  const d = e164.slice(1)
  const match = [...codes].sort((a, b) => b.code.length - a.code.length).find((c) => d.startsWith(c.code))
  return match ? { country: match.code, national: d.slice(match.code.length) } : { country: '27', national: e164 }
}

// "+27821234567" -> "+27 82 123 4567" for display. Other countries get light grouping.
export function formatPhone(e164: string | null | undefined): string {
  if (!e164) return ''
  const m = /^\+27(\d{2})(\d{3})(\d{4})$/.exec(e164)
  if (m) return `+27 ${m[1]} ${m[2]} ${m[3]}`
  return e164
}

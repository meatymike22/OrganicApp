// ONE canonical form for every barcode stored in Product.upc.
//
// WHY: the same product can arrive as a 12-digit UPC-A ("058449772057") or
// as a 13-digit EAN with a leading zero ("0058449772057"). They're the same
// barcode — but as text they're different, so without normalizing, the
// unique constraint on Product.upc would happily store the product twice.
//
// CANONICAL FORM: 13-digit EAN-13, which is what Open Food Facts uses and
// what most rows already were.
//   12 digits (UPC-A)             → prepend "0"
//   13 digits (EAN-13)            → as is
//   14 digits (GTIN-14) with a leading "0" → drop that "0"
//   8 digits, UPC-E (US short code) → expanded to its full UPC-A, then as above
//   8 digits, EAN-8               → as is (a separate, shorter numbering
//                                    system; padding it would invent a code)
//   9–11 digits                   → leading zeros restored, IF the check
//                                    digit then validates
// Anything else is rejected.
//
// EVERY place that writes or looks up Product.upc — ingestion scripts and,
// later, the barcode scanner — must pass codes through normalizeUpc() first.

export type UpcResult =
  | { ok: true; upc: string }
  | { ok: false; reason: 'empty' | 'bad_length' | 'bad_check_digit' | 'restricted'; raw: string }

// GS1 check digit: every barcode's last digit is computed from the others,
// so a single mistyped digit is caught. This is the "one wrong digit
// silently pulls a completely different product" problem noted in
// discover-products.ts — this catches it before it's stored.
export function hasValidCheckDigit(digits: string): boolean {
  if (!/^\d+$/.test(digits) || digits.length < 8) return false
  const body = digits.slice(0, -1)
  const check = Number(digits[digits.length - 1])
  let sum = 0
  // Weights alternate 3,1,3,1... starting from the digit next to the check digit
  for (let i = 0; i < body.length; i++) {
    const digit = Number(body[body.length - 1 - i])
    sum += digit * (i % 2 === 0 ? 3 : 1)
  }
  return (10 - (sum % 10)) % 10 === check
}

// GS1 prefixes 02x, 04x and 20x–29x are "restricted circulation" — store-made
// codes for deli items, weighed produce, loyalty items. (04x is the 13-digit
// form of a UPC-A starting with 4, the US "in-store use" range.) They're reused by every
// store, so they don't identify one product anywhere else and must never be
// stored as a product's barcode. (Same rule discover-products.ts used.)
export function isRestrictedBarcode(ean13: string): boolean {
  if (ean13.length !== 13) return false
  const p3 = Number(ean13.slice(0, 3))
  return ean13.startsWith('02') || ean13.startsWith('04') || (p3 >= 200 && p3 <= 299)
}

// UPC-E is the short 8-digit barcode on small US packages (soda cans, candy,
// gum). It's a compressed UPC-A: expanding it gives the full 12-digit code,
// and the check digit only validates against that expanded form. Rules are
// GS1's, keyed on the 6th data digit. Returns null if it isn't UPC-E-shaped.
export function expandUpcE(code8: string): string | null {
  if (!/^[01]\d{7}$/.test(code8)) return null
  const ns = code8[0]
  const d = code8.slice(1, 7)
  const check = code8[7]
  const last = d[5]
  let body: string // the 10 digits between number system and check digit
  if (last === '0' || last === '1' || last === '2') body = d[0] + d[1] + last + '0000' + d[2] + d[3] + d[4]
  else if (last === '3') body = d[0] + d[1] + d[2] + '00000' + d[3] + d[4]
  else if (last === '4') body = d[0] + d[1] + d[2] + d[3] + '00000' + d[4]
  else body = d[0] + d[1] + d[2] + d[3] + d[4] + '0000' + last
  return ns + body + check // 12-digit UPC-A
}

export function normalizeUpc(raw: unknown): UpcResult {
  const input = String(raw ?? '')
  let digits = input.replace(/\D/g, '')

  if (!digits) return { ok: false, reason: 'empty', raw: input }

  if (digits.length === 14 && digits.startsWith('0')) digits = digits.slice(1)

  // 8 digits: UPC-E (US) or EAN-8 (elsewhere). Try UPC-E first — this import
  // is US products — and store it EXPANDED, so the same product scanned as
  // UPC-E or as its full UPC-A lands on one record. Fall back to EAN-8.
  // (The first dry run rejected most of these as "bad check digit", because
  // a UPC-E's check digit is computed on the expanded code.)
  if (digits.length === 8) {
    const expanded = expandUpcE(digits)
    if (expanded && hasValidCheckDigit(expanded)) digits = expanded
  }

  // 9–11 digits: a UPC-A whose leading zeros were dropped somewhere along the
  // way (spreadsheets do this to numbers). Pad back to 13 and accept only if
  // the check digit then validates — a truncated or mistyped code won't.
  if (digits.length >= 9 && digits.length <= 11) {
    const padded = digits.padStart(13, '0')
    if (hasValidCheckDigit(padded)) digits = padded
  }

  if (digits.length === 12) digits = '0' + digits

  if (digits.length !== 13 && digits.length !== 8) {
    return { ok: false, reason: 'bad_length', raw: input }
  }
  if (!hasValidCheckDigit(digits)) {
    return { ok: false, reason: 'bad_check_digit', raw: input }
  }
  if (isRestrictedBarcode(digits)) {
    return { ok: false, reason: 'restricted', raw: input }
  }
  return { ok: true, upc: digits }
}

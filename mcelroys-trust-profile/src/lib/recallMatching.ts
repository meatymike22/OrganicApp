// Pure matching rules for scripts/match-recalls.ts, kept separate so they can
// be tested without a database or network.
//
// THE SAFETY RULE behind all of it: a recall shown on the wrong company's or
// product's page is a false public claim about a real business. So every
// rule here prefers missing a match (it can be added later) over inventing
// one. See the RegulatoryActionLink model in prisma/schema.prisma for how the
// links are shown.
import * as zlib from 'zlib'
import { normalizeBrandName } from '@/lib/brandMatching'
import { normalizeUpc } from '@/lib/upc'

// ---------------------------------------------------------------------------
// FIRM NAMES → lookup keys
// ---------------------------------------------------------------------------

// The name forms a notice's firm can take, each reduced to the shared brand
// key (normalizeBrandName, the same rule used for the company merge).
//   "Acme Foods, Inc. of Chicago, IL"  → also tried without ", of Chicago, IL"
//     (FSIS and CPSC append the location; it is not part of the name)
//   "Acme Holdings dba Acme Foods"     → both names
export function firmKeys(firm: string): string[] {
  const out = new Set<string>()
  const add = (s: string) => {
    const t = s.trim()
    if (t.length < 2) return
    const k = normalizeBrandName(t)
    if (k.length >= 2) out.add(k)
  }
  const parts = firm.split(/\s+(?:d\/?b\/?a|a\/?k\/?a|t\/?a)\.?\s+/i)
  for (const p of parts) {
    add(p)
    // Only a LOCATION is stripped: ", of Houston, Texas" or "of Houston,
    // Texas". "Olympus Corporation of the Americas" and "MG Foods of Texas"
    // keep their "of", because there it is part of the name — stripping it
    // matched a medical-device maker to a yogurt brand called Olympus.
    add(p.replace(/,\s*of\s+.+$/i, '').replace(/\s+of\s+[A-Za-z][A-Za-z .'-]*,\s*[A-Za-z].*$/i, ''))
  }
  return [...out]
}

// ---------------------------------------------------------------------------
// BARCODES in notice text
// ---------------------------------------------------------------------------

export type FoundUpc = { upc: string; text: string; keyword: boolean }

const KEYWORD_RE = /\b(?:UPC|GTIN|EAN|BAR\s*CODE|BARCODE)S?(?:\s*(?:#|NO\.?|NOS\.?|NUMBERS?|CODES?))*\s*[:#.]?\s*/gi

// Every barcode a notice lists. Notices write them many ways:
//   "UPC 0 5844959077 4"   "UPC: 0-58449-59077-4"   "UPC 058449590774"
//   "UPC Codes: 012345678905, 012345678912 and 012345678929"
// Digits are only read as a barcode when the check digit validates, and
// `exists` (our own product lookup) decides between readings of an ambiguous
// run such as "UPC 012345678905 12 oz". A bare 12–13 digit run with no "UPC"
// keyword is accepted only if it is one of our products' barcodes.
export function extractUpcs(text: string, exists: (upc: string) => boolean): FoundUpc[] {
  const found = new Map<string, FoundUpc>()
  if (!text) return []

  // 1. After a keyword: read the list that follows.
  for (const m of text.matchAll(KEYWORD_RE)) {
    const start = (m.index ?? 0) + m[0].length
    const tail = text.slice(start, start + 400)
    // The list ends at the first character that can't be part of it.
    const listMatch = tail.match(/^[\d\s\-–,;/&]*(?:\s*(?:and|or)\s*[\d\s\-–,;/&]+)*/i)
    if (!listMatch) continue
    for (const item of listMatch[0].split(/\s*(?:,|;|\/|&|\band\b|\bor\b)\s*/i)) {
      const groups = item.split(/[\s\-–]+/).filter((g) => /^\d+$/.test(g))
      const pick = bestReading(groups, exists)
      if (pick && !found.has(pick)) found.set(pick, { upc: pick, text: item.trim(), keyword: true })
    }
  }

  // 2. Bare runs anywhere, only when they are one of our barcodes.
  for (const m of text.matchAll(/(?<![\d])(\d{12,13})(?![\d])/g)) {
    const r = normalizeUpc(m[1])
    if (r.ok && exists(r.upc) && !found.has(r.upc)) found.set(r.upc, { upc: r.upc, text: m[1], keyword: false })
  }
  return [...found.values()]
}

// Joins leading digit groups ("0", "5844959077", "4") into candidate codes of
// barcode length and returns the best valid one: one we have a product for,
// else the longest valid reading.
function bestReading(groups: string[], exists: (upc: string) => boolean): string | null {
  const valid: string[] = []
  let acc = ''
  for (const g of groups) {
    acc += g
    if (acc.length > 14) break
    if ([8, 11, 12, 13, 14].includes(acc.length)) {
      const r = normalizeUpc(acc)
      if (r.ok) valid.push(r.upc)
    }
  }
  if (!valid.length) return null
  return valid.find(exists) ?? valid[valid.length - 1]
}

// ---------------------------------------------------------------------------
// BRAND NAMES in notice text
// ---------------------------------------------------------------------------

// Word form used for phrase search: uppercase, apostrophes dropped
// ("Nature's" → "NATURES"), accents removed, everything else a single space.
export function wordForm(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[’‘'`´]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

const CORP_WORDS = new Set(['INC', 'INCORPORATED', 'LLC', 'LLP', 'LP', 'CO', 'CORP', 'CORPORATION', 'LTD', 'LIMITED', 'COMPANY', 'PBC', 'PLC', 'GMBH', 'AG', 'SA', 'SAS', 'SPA', 'SRL', 'BV', 'NV', 'USA', 'US'])

// A brand name as a searchable phrase, or null if it is too short or too
// generic to be evidence on its own. Corporate suffixes and a leading "THE"
// are dropped: "The Hain Celestial Group, Inc." → "HAIN CELESTIAL GROUP".
export function brandPhrase(name: string): string | null {
  const words = wordForm(name).split(' ').filter(Boolean)
  while (words.length > 1 && CORP_WORDS.has(words[words.length - 1])) words.pop()
  if (words[0] === 'THE' && words.length > 1) words.shift()
  const phrase = words.join(' ')
  if (phrase.replace(/ /g, '').length < 4) return null
  if (words.length === 1 && GENERIC_WORDS.has(phrase)) return null
  return phrase
}

// Business words that often follow a brand in a company's legal name but not
// on the package: "Nature's Path Foods" is printed "Nature's Path".
const TRAILING_BUSINESS_WORDS = new Set(['FOODS', 'FOOD', 'BRANDS', 'BRAND', 'GROUP', 'HOLDINGS', 'ENTERPRISES', 'ENTERPRISE', 'INDUSTRIES', 'INTERNATIONAL', 'PRODUCTS', 'MANUFACTURING', 'DISTRIBUTING', 'DISTRIBUTORS', 'SALES', 'OPERATIONS', 'COMPANY', 'CO', 'INC', 'LLC', 'CORP', 'CORPORATION', 'USA', 'US', 'AMERICA', 'NORTH'])

// Every searchable phrase for one name: the full phrase and, if different,
// the phrase without trailing business words. Each passes brandPhrase()'s
// length and generic-word guard.
export function brandPhrases(name: string): string[] {
  const out = new Set<string>()
  const full = brandPhrase(name)
  if (full) {
    out.add(full)
    const words = full.split(' ')
    while (words.length > 1 && TRAILING_BUSINESS_WORDS.has(words[words.length - 1])) words.pop()
    const short = brandPhrase(words.join(' '))
    // A one-word remainder must be distinctive: at least 5 letters.
    if (short && (short.includes(' ') || short.length >= 5)) out.add(short)
  }
  return [...out]
}

// Single words that name a food, a quality or a pack type, and so appear in
// product descriptions whether or not a brand of that name is involved
// ("Organic", "Fresh", "Classic"). A brand whose whole name is one of these
// is never matched by name alone; it can still match by barcode.
export const GENERIC_WORDS = new Set(
  (
    'ORGANIC ORGANICS NATURAL NATURALS FRESH CLASSIC ORIGINAL PREMIUM SELECT CHOICE PURE SIMPLE SIMPLY ' +
    'GOLD GOLDEN ROYAL CROWN STAR SUN SUNSHINE HARVEST FARM FARMS GARDEN KITCHEN BAKERY DAIRY MARKET ' +
    'CHICKEN BEEF PORK TURKEY FISH SALMON TUNA SHRIMP CHEESE MILK BUTTER CREAM YOGURT EGGS EGG BREAD ' +
    'COOKIE COOKIES CANDY CHOCOLATE COFFEE TEA WATER JUICE SOUP SAUCE SALSA SPICE SPICES HONEY NUTS ' +
    'RICE PASTA PIZZA SALAD FRUIT FRUITS APPLE ORANGE LEMON BERRY BERRIES GREEN RED BLUE WHITE BLACK ' +
    'FROZEN RAW COOKED SMOKED DRIED CANNED SWEET SPICY HOT MILD BEST GOOD GREAT HAPPY HEALTHY LIFE ' +
    'FOOD FOODS BRAND BRANDS PRODUCTS PRODUCT FAMILY HOME COUNTRY VALLEY MOUNTAIN RIVER OCEAN ISLAND ' +
    'SNACK SNACKS TREATS DELI GOURMET ARTISAN HOMESTYLE TRADITIONAL VEGAN KETO PROTEIN ENERGY'
  ).split(' ')
)

// True when `phrase` appears in `haystack` as whole words (both already in
// wordForm).
export function containsPhrase(haystack: string, phrase: string): boolean {
  return (' ' + haystack + ' ').includes(' ' + phrase + ' ')
}

// Like containsPhrase, but an occurrence right after "BY", "FOR" or "FROM"
// doesn't count: "Manufactured by Acme Foods", "Distributed for Acme",
// "Packed for Kroger" name who made or sold the product, not its brand. A
// co-packer recalling a store brand writes its own name that way.
export function mentionsBrand(haystack: string, phrase: string): boolean {
  const h = ' ' + haystack + ' '
  const needle = ' ' + phrase + ' '
  let i = h.indexOf(needle)
  while (i !== -1) {
    const before = h.slice(0, i).trimEnd().split(' ').pop() ?? ''
    if (!['BY', 'FOR', 'FROM'].includes(before)) return true
    i = h.indexOf(needle, i + 1)
  }
  return false
}

// ---------------------------------------------------------------------------
// ZIP (openFDA bulk files are single-file .zip archives)
// ---------------------------------------------------------------------------

// Minimal reader for the standard zip layout, enough for openFDA's files, so
// the project needs no extra dependency. Returns each file's name and bytes.
export function unzip(buf: Buffer): { name: string; data: Buffer }[] {
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('Not a zip file (no end-of-directory record)')
  const count = buf.readUInt16LE(eocd + 10)
  let p = buf.readUInt32LE(eocd + 16)
  const files: { name: string; data: Buffer }[] = []
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Bad zip central directory')
    const method = buf.readUInt16LE(p + 10)
    const compSize = buf.readUInt32LE(p + 20)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const localOffset = buf.readUInt32LE(p + 42)
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen)
    if (compSize === 0xffffffff || localOffset === 0xffffffff) throw new Error('Zip64 archives are not supported')
    const lNameLen = buf.readUInt16LE(localOffset + 26)
    const lExtraLen = buf.readUInt16LE(localOffset + 28)
    const start = localOffset + 30 + lNameLen + lExtraLen
    const raw = buf.subarray(start, start + compSize)
    const data = method === 0 ? Buffer.from(raw) : method === 8 ? zlib.inflateRawSync(raw) : null
    if (!data) throw new Error(`Unsupported zip compression method ${method} for ${name}`)
    files.push({ name, data })
    p += 46 + nameLen + extraLen + commentLen
  }
  return files
}

// FSIS returns HTML-encoded text in several fields (same decoding as
// ingest-fsis-recalls.ts).
export function stripHtml(s: string): string {
  return s
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;|&rsquo;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&ndash;|&mdash;/g, '-')
    .replace(/&bull;/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
}

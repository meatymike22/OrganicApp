import * as XLSX from 'xlsx'

// Usage: npx tsx scripts/search-usda.ts ./data/INTEGRITY_Export_2025.xlsx "one degree"
const FILE_PATH = process.argv[2]
const SEARCH_TERM = process.argv[3]?.toLowerCase()

if (!FILE_PATH || !SEARCH_TERM) {
  console.error('Usage: npx tsx scripts/search-usda.ts ./data/INTEGRITY_Export_2025.xlsx "search term"')
  process.exit(1)
}

const workbook = XLSX.readFile(FILE_PATH)
const sheet = workbook.Sheets['Operations']
const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 })

const headerRowIndex = rows.findIndex((row) => row[0] === 'Cert_name')
const headers = rows[headerRowIndex] as string[]
const dataRows = rows.slice(headerRowIndex + 3)

const nameIdx = headers.indexOf('op_name')
const otherIdx = headers.indexOf('op_otherNames')
const certIdx = headers.indexOf('op_nopOpID')

let found = 0
for (const row of dataRows) {
  const name = String(row[nameIdx] ?? '')
  const other = String(row[otherIdx] ?? '')
  const certNumber = String(row[certIdx] ?? '')
  // Match on name, other names, OR an exact certificate number —
  // useful when you already know the NOP ID and just want to see
  // exactly how USDA has the name spelled/formatted for that record
  if (
    name.toLowerCase().includes(SEARCH_TERM) ||
    other.toLowerCase().includes(SEARCH_TERM) ||
    certNumber === process.argv[3]
  ) {
    found++
    console.log(`op_name: "${name}"`)
    console.log(`op_otherNames: "${other}"`)
    console.log(`certificateNumber: ${row[certIdx]}`)
    console.log('---')
  }
}

console.log(`\nFound ${found} matching row(s) for "${SEARCH_TERM}"`)
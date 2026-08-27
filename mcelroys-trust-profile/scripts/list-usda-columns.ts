import * as XLSX from 'xlsx'

const FILE_PATH = process.argv[2]
if (!FILE_PATH) {
  console.error('Usage: npx tsx scripts/list-usda-columns.ts ./data/INTEGRITY_Export_20260801.xlsx')
  process.exit(1)
}

const workbook = XLSX.readFile(FILE_PATH)
const sheet = workbook.Sheets['Operations']
const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 })

const headerRowIndex = rows.findIndex((row) => row[0] === 'Cert_name')
const headers = rows[headerRowIndex] as string[]

// Print every column name with its index, so we can find date-related fields
headers.forEach((h, i) => {
  if (h) console.log(`${i}: ${h}`)
})

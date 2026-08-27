import 'dotenv/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import * as fs from 'fs'
import * as path from 'path'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

const logLines: string[] = []

function log(...args: unknown[]) {
  const line = args
    .map((a) => (typeof a === 'string' ? a : JSON.stringify(a, null, 2)))
    .join(' ')
  console.log(line)
  logLines.push(line)
}

function writeLogFile(prefix: string) {
  const dir = './logs'
  fs.mkdirSync(dir, { recursive: true })
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const filePath = path.join(dir, `${prefix}-${timestamp}.txt`)
  fs.writeFileSync(filePath, logLines.join('\n'))
  console.log(`\nFull output saved to ${filePath}`)
}

async function main() {
  const allNutritionFacts = await prisma.nutritionFacts.findMany()
  log('Direct NutritionFacts query:', allNutritionFacts)

  const allProductIngredients = await prisma.productIngredient.findMany({
    include: { ingredient: true },
  })
  log('Direct ProductIngredient query:', allProductIngredients)
}

main()
  .catch((e) => log('[ERROR]', e instanceof Error ? e.message : e))
  .finally(async () => {
    writeLogFile('diagnose-nutrition')
    await prisma.$disconnect()
  })
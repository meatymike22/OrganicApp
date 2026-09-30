// Loads variables from .env (like DATABASE_URL) into process.env
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

async function dumpDatabase() {
  // Fetch companies with the relations that have worked reliably through
  // nested includes so far
  const companies = await prisma.company.findMany({
    include: {
      products: {
        include: {
          certifications: true,
        },
      },
      ownershipCertifications: true,
      investorFilings: true,
      regulatoryActions: true,
      supplyChainDisclosures: true,    // what the company says about its own supply chain
      independentInvestigations: true, // adversarial third-party findings about the company
      // Parent/subsidiary ownership. Only scalar fields are selected on the
      // related companies to avoid recursing infinitely through the
      // self-referencing relation.
      parentCompany: {
        select: { id: true, legalName: true, hqLocation: true },
      },
      subsidiaries: {
        select: { id: true, legalName: true, hqLocation: true },
      },
    },
  })

  // NutritionFacts and ProductIngredient are fetched as SEPARATE, flat,
  // top-level queries instead of nested through Company -> products, since
  // the deeply-nested version was silently returning empty results despite
  // the data genuinely existing (confirmed via direct query + Prisma Studio).
  // Fetching flat and merging in JS sidesteps whatever was going wrong with
  // that specific nested structure.
  const allNutritionFacts = await prisma.nutritionFacts.findMany()
  const allProductIngredients = await prisma.productIngredient.findMany({
    include: { ingredient: true },
  })

  // Attach the flat results onto their matching products by productId
  const result = companies.map((company) => ({
    ...company,
    products: company.products.map((product) => ({
      ...product,
      nutritionFacts: allNutritionFacts.find((nf) => nf.productId === product.id) ?? null,
      productIngredients: allProductIngredients.filter((pi) => pi.productId === product.id),
    })),
  }))

  log(JSON.stringify(result, null, 2))
}

dumpDatabase()
  .catch((e) => console.error(e))
  .finally(async () => {
    writeLogFile('dump-db')
    await prisma.$disconnect()
  })

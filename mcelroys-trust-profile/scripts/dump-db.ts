// Loads variables from .env (like DATABASE_URL) into process.env
// Required because this script isn't run through the Prisma CLI, which does this automatically
import 'dotenv/config'

// The Postgres-specific "driver adapter" Prisma 7 requires to actually connect
import { PrismaPg } from '@prisma/adapter-pg'

// The generated client that knows about your schema's models (Company, Product, etc.)
import { PrismaClient } from '@prisma/client'

// Tells the adapter which database to connect to, using the connection string from .env
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })

// The actual client you use to query the database — pass it the adapter so it knows how to connect
const prisma = new PrismaClient({ adapter })

// An async function since database queries take time and can't return instantly
async function dumpDatabase() {
  // Fetch every Company row, and use "include" to also pull in related rows
  // from other tables (nested one level deeper each time) instead of just the Company fields alone
  const companies = await prisma.company.findMany({
    include: {
      products: {
        include: {
          certifications: true, // each product's OrganicCertification rows
        },
      },
      ownershipCertifications: true, // this company's OwnershipCertification rows
      investorFilings: true,         // this company's InvestorFiling rows
    },
  })

  // Print the whole nested result as formatted, readable JSON in the terminal
  console.log(JSON.stringify(companies, null, 2))
}

// Actually run the function, then always disconnect afterward (success or failure)
dumpDatabase()
  .catch((e) => console.error(e))       // print any error instead of crashing silently
  .finally(async () => {
    await prisma.$disconnect()          // close the database connection cleanly when done
  })
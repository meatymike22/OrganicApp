// Postgres-specific driver adapter, required by Prisma 7 to actually connect
import { PrismaPg } from '@prisma/adapter-pg'
// The generated client that knows about your schema's models (Company, Product, etc.)
import { PrismaClient } from '@prisma/client'

// TypeScript doesn't know about custom properties on Node's "global" object by default,
// so this line tells it: trust me, "global" can also hold a "prisma" property of type PrismaClient
const globalForPrisma = global as unknown as { prisma: PrismaClient }

// Tells Prisma which database to connect to, using the connection string from .env
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })

// Reuse one PrismaClient across hot-reloads in development, instead of creating a new one
// every time you save a file. Without this, Next.js's dev server would open a fresh DB
// connection on every save and eventually exhaust your connection pool.
// "globalForPrisma.prisma || ..." means: use the existing one if it's already there,
// otherwise create a new one.
export const prisma = globalForPrisma.prisma || new PrismaClient({ adapter })

// Only cache the client on "global" in development — in production, a fresh instance
// per server start is fine and safer.
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

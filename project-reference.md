# Rootify MVP — Project Reference (as of Groups 1–4 build, Step 8 complete)

## Project structure
```
mcelroys-trust-profile/
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── src/
│   ├── lib/
│   │   └── prisma.ts
│   └── app/
│       └── companies/
│           └── [id]/
│               └── page.tsx
├── scripts/
│   ├── dump-db.ts
│   └── ingest-usda.ts
├── data/
│   └── INTEGRITY_Export_2025.xlsx   (renamed from .csv — it's actually xlsx)
├── prisma.config.ts
└── .env   (DATABASE_URL — never commit)
```

---

## prisma/schema.prisma

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
}

model Company {
  id            String    @id @default(dbgenerated("gen_random_uuid()"))
  legalName     String
  dbaNames      String[]  @default([])
  hqLocation    String?
  createdAt     DateTime  @default(now())

  products               Product[]
  ownershipCertifications OwnershipCertification[]
  investorFilings         InvestorFiling[]
}

model Product {
  id          String   @id @default(dbgenerated("gen_random_uuid()"))
  name        String
  category    String?
  companyId   String
  company     Company  @relation(fields: [companyId], references: [id])
  createdAt   DateTime @default(now())

  certifications OrganicCertification[]
}

model OrganicCertification {
  id                  String   @id @default(dbgenerated("gen_random_uuid()"))
  productId           String
  product             Product  @relation(fields: [productId], references: [id])
  certifyingBody      String
  certificateNumber   String
  certificationStatus String
  certifiedScopes     String[] @default([])
  effectiveDate       DateTime?
  lastVerifiedDate    DateTime

  sourceUrl      String
  sourceType     String   @default("regulatory_filing")
  dataPulledDate DateTime @default(now())
  aiDrafted      Boolean  @default(false)
  reviewerId     String?
  reviewDate     DateTime?
}

model OwnershipCertification {
  id                    String   @id @default(dbgenerated("gen_random_uuid()"))
  companyId             String
  company               Company  @relation(fields: [companyId], references: [id])
  mbeCertified          Boolean  @default(false)
  wbeCertified          Boolean  @default(false)
  veteranOwnedCertified Boolean  @default(false)
  dbeCertified          Boolean  @default(false)
  certifyingBody        String?

  sourceUrl      String
  sourceType     String   @default("regulatory_filing")
  dataPulledDate DateTime @default(now())
  aiDrafted      Boolean  @default(false)
  reviewerId     String?
  reviewDate     DateTime?
}

model InvestorFiling {
  id                        String   @id @default(dbgenerated("gen_random_uuid()"))
  companyId                 String
  company                   Company  @relation(fields: [companyId], references: [id])
  ticker                    String?
  majorShareholders         Json?
  institutionalOwnershipPct Float?
  filingDate                DateTime?
  publicStatus              String   @default("public")
  parentCompany             String?

  sourceUrl      String
  sourceType     String   @default("regulatory_filing")
  dataPulledDate DateTime @default(now())
  aiDrafted      Boolean  @default(false)
  reviewerId     String?
  reviewDate     DateTime?
}

model IngestionLog {
  id             String   @id @default(dbgenerated("gen_random_uuid()"))
  source         String
  ranAt          DateTime @default(now())
  recordsMatched Int
  fileName       String
}
```

---

## prisma.config.ts
```ts
import "dotenv/config";
import { defineConfig } from "prisma/config";
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env["DATABASE_URL"],
  },
});
```

## .env
```
DATABASE_URL="postgresql://postgres.[project-ref]:[password]@[region].pooler.supabase.com:5432/postgres"
```
Must use the **Session Pooler** connection string (IPv4-compatible), not the direct `db.xxx.supabase.co` host (IPv6-only, usually unreachable).

---

## src/lib/prisma.ts
```ts
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'

const globalForPrisma = global as unknown as { prisma: PrismaClient }
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
export const prisma = globalForPrisma.prisma || new PrismaClient({ adapter })
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
```

## src/app/companies/[id]/page.tsx
Reads one company plus all related products/certifications/filings and renders them (full commented version already delivered in-conversation earlier).

## scripts/dump-db.ts
Prints the entire database (all companies + nested relations) as JSON to the terminal. Usage:
```
npx tsx scripts/dump-db.ts
```

## scripts/ingest-usda.ts
Parses the USDA OID "Operations" export sheet, matches against `Company.legalName`/`dbaNames` (handling combined "Name dba Other Name; Another Name" strings), builds `certifiedScopes`, extracts `sourceUrl`, checks for existing records by `certificateNumber` before writing (update vs. create), and logs the run to `IngestionLog`. Usage:
```
# Dry run (default, safe, no writes)
npx tsx scripts/ingest-usda.ts ./data/INTEGRITY_Export_2025.xlsx

# Live run — actually writes to the database
npx tsx scripts/ingest-usda.ts ./data/INTEGRITY_Export_2025.xlsx --live
```

---

## Common commands reference

| Task | Command |
|---|---|
| Start dev server | `npm run dev` |
| Create/update DB tables after schema changes | `npx prisma migrate dev --name <description>` |
| Regenerate Prisma Client manually | `npx prisma generate` |
| Open visual DB browser | `npx prisma studio` |
| Check Prisma version/config | `npx prisma -v` |
| Dump full DB to terminal | `npx tsx scripts/dump-db.ts` |
| Run USDA ingestion (dry run) | `npx tsx scripts/ingest-usda.ts ./data/FILE.xlsx` |
| Run USDA ingestion (live) | `npx tsx scripts/ingest-usda.ts ./data/FILE.xlsx --live` |
| Fix PowerShell script blocking | `Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser` (run as Administrator) |
| Fix folder ownership (Windows) | `takeown /f "PATH" /r /d y` then `icacls "PATH" /grant "USERNAME:F" /t` |

---

## Known gotchas hit this session (for future reference)
- **Prisma 7 breaking changes:** `datasource.url` moved from `schema.prisma` to `prisma.config.ts`; `PrismaClient` requires an explicit driver adapter (`@prisma/adapter-pg`) — plain `new PrismaClient()` fails with "no options" error.
- **`@default(uuid())` is application-layer only** — only works when Prisma Client itself does the insert. Raw SQL/Studio inserts bypass it entirely. Use `@default(dbgenerated("gen_random_uuid()"))` instead for a true database-level default (requires `CREATE EXTENSION IF NOT EXISTS pgcrypto;`).
- **Supabase direct connection (`db.xxx.supabase.co`) is IPv6-only** — often unreachable. Use the Session Pooler connection string instead.
- **Prisma Studio's array-field editor is unreliable** — use Supabase SQL Editor for array updates (`UPDATE ... SET col = ARRAY['a','b']`) and for deletes (Studio's delete also proved unreliable, and doesn't auto-cascade to child rows — delete children before parents).
- **USDA OID export files download with a `.csv` extension but are actually `.xlsx`** — rename before use.
- **USDA OID data is at the operation/company level, not per-product** — the ingestion script currently applies a matched cert to every product under that company as a workaround; worth reconsidering if the schema evolves.

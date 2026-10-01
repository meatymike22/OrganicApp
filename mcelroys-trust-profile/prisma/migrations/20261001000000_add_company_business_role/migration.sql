-- Company.businessRole: brand / supply_chain (middlemen between source and
-- shelf, e.g. co-packers, importers, distributors) / retailer. See schema.prisma.
ALTER TABLE "Company" ADD COLUMN "businessRole" TEXT;

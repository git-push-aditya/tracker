import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

const g = globalThis as unknown as { prisma?: PrismaClient };

// Only call when DATABASE_URL is set (see data-source.ts); cached so dev hot-reload doesn't leak connections.
// ponytail: ssl without CA verification (Supabase's pooler uses its own CA); pin their CA cert if that matters.
// max stays small: every serverless instance opens its own pool against Supabase's pooler.
// A new connection costs ~1-2 s to the Tokyo pooler, so: keep idle ones for 5 min, and give connects / transaction
// starts room. pg's default connectionTimeoutMillis is 0 = wait forever, which turned one stalled connect into a hung request.
export function prisma(): PrismaClient {
  return (g.prisma ??= new PrismaClient({
    adapter: new PrismaPg({
      connectionString: process.env.DATABASE_URL,
      ssl: /@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "") ? false : { rejectUnauthorized: false }, // local dev Postgres has no TLS
      max: 5,
      idleTimeoutMillis: 300_000,
      connectionTimeoutMillis: 15_000,
    }),
    transactionOptions: { maxWait: 15_000, timeout: 30_000 },
  }));
}

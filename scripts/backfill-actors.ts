// Builds Actor rows from the owner text already in the database and links every row to its actor.
// Idempotent: safe to run on every deploy (also repairs rows an older deployment wrote with a null ownerId).
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { actorKey, cleanName } from "../src/lib/actors";

const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }),
});

async function main() {
  // distinct owner strings with how often each is used
  const counts = new Map<string, number>();
  const add = (rows: { owner: string }[]) => rows.forEach((r) => counts.set(r.owner, (counts.get(r.owner) ?? 0) + 1));
  add(await db.task.findMany({ select: { owner: true } }));
  add(await db.workstream.findMany({ select: { owner: true } }));
  add(await db.taskEvent.findMany({ select: { owner: true } }));

  // per person: the most used spelling wins (ties: mixed case, then code-point order)
  const spellings = new Map<string, Map<string, number>>();
  for (const [raw, n] of counts) {
    const name = cleanName(raw);
    if (!name) continue;
    const m = spellings.get(actorKey(name)) ?? new Map<string, number>();
    m.set(name, (m.get(name) ?? 0) + n);
    spellings.set(actorKey(name), m);
  }
  const actors = new Map<string, { id: string; name: string }>();
  for (const [key, m] of spellings) {
    const mixed = (n: string) => (/[a-z]/.test(n) && /[A-Z]/.test(n) ? 1 : 0); // "Rohan" beats "rohan" / "ROHAN" on a tie
    const name = [...m].sort((a, b) => b[1] - a[1] || mixed(b[0]) - mixed(a[0]) || (a[0] < b[0] ? -1 : 1))[0][0];
    // an existing actor keeps its name (it may have been renamed on purpose)
    actors.set(key, await db.actor.upsert({ where: { nameKey: key }, update: {}, create: { name, nameKey: key }, select: { id: true, name: true } }));
  }

  // link rows and make the text equal to the actor's name
  for (const raw of counts.keys()) {
    const a = actors.get(actorKey(raw));
    if (!a) continue;
    const data = { ownerId: a.id, owner: a.name };
    const where = { owner: raw };
    await db.task.updateMany({ where, data });
    await db.workstream.updateMany({ where, data });
    await db.taskEvent.updateMany({ where, data });
  }
  console.log(`Backfill: ${actors.size} actor(s) from ${counts.size} distinct owner value(s).`);
}

main().finally(() => db.$disconnect());

import type { Prisma } from "@/generated/prisma/client";

// Anything with an `actor` delegate: the Prisma client itself or a transaction.
type Db = Pick<Prisma.TransactionClient, "actor">;

/** What people see: trimmed, inner whitespace collapsed. */
export const cleanName = (name: string) => name.trim().replace(/\s+/g, " ");
/** What decides "same person": cleaned, NFKC-normalised, lower-cased. No fuzzy matching. */
export const actorKey = (name: string) => cleanName(name).normalize("NFKC").toLowerCase();

/**
 * Finds the actor for a typed/selected name, creating it if new. An empty name means "no owner" (null).
 * Uses upsert (INSERT … ON CONFLICT) because a unique-violation inside a Postgres transaction would abort it.
 * The returned name is the stored one, so "rohan" comes back as "Rohan" when that person already exists.
 */
export async function resolveActor(db: Db, name: string) {
  const clean = cleanName(name);
  if (!clean) return null;
  const a = await db.actor.upsert({ where: { nameKey: actorKey(clean) }, update: {}, create: { name: clean, nameKey: actorKey(clean) }, select: { id: true, name: true } });
  return a;
}

/** `{ owner, ownerId }` columns for a write. */
export async function ownerColumns(db: Db, name: string) {
  const a = await resolveActor(db, name);
  return { owner: a?.name ?? "", ownerId: a?.id ?? null };
}

/** For import: resolve every distinct name once. Keys are actorKey(name). */
export async function resolveMany(db: Db, names: string[]) {
  const out = new Map<string, { id: string; name: string }>();
  for (const n of names) {
    const k = actorKey(n);
    if (k && !out.has(k)) out.set(k, (await resolveActor(db, n))!);
  }
  return out;
}

// ---- management (Settings → People). Each takes a transaction client and throws ActorError on a refusal. ----
export class ActorError extends Error {
  constructor(readonly status: 404 | 409, message: string) { super(message); }
}
type Tx = Prisma.TransactionClient;

const rewriteOwner = async (tx: Tx, ownerId: string, data: { ownerId?: string; owner: string }) => {
  await tx.task.updateMany({ where: { ownerId }, data });
  await tx.workstream.updateMany({ where: { ownerId }, data });
  await tx.taskEvent.updateMany({ where: { ownerId }, data });
};

export async function renameActor(tx: Tx, id: string, newName: string) {
  const name = cleanName(newName), key = actorKey(name);
  if (!(await tx.actor.findUnique({ where: { id }, select: { id: true } }))) throw new ActorError(404, "Person not found");
  const clash = await tx.actor.findUnique({ where: { nameKey: key }, select: { id: true } });
  if (clash && clash.id !== id) throw new ActorError(409, "Someone with that name already exists — merge them instead");
  const actor = await tx.actor.update({ where: { id }, data: { name, nameKey: key } });
  await rewriteOwner(tx, id, { owner: name });
  return actor;
}

export async function mergeActors(tx: Tx, fromId: string, intoId: string) {
  if (fromId === intoId) throw new ActorError(409, "Pick a different person to merge into");
  const [from, into] = await Promise.all([tx.actor.findUnique({ where: { id: fromId } }), tx.actor.findUnique({ where: { id: intoId } })]);
  if (!from || !into) throw new ActorError(404, "Person not found");
  await rewriteOwner(tx, fromId, { ownerId: into.id, owner: into.name });
  await tx.actor.delete({ where: { id: fromId } });
  return into;
}

export async function deleteActor(tx: Tx, id: string) {
  const a = await tx.actor.findUnique({ where: { id }, include: { _count: { select: { tasks: true, workstreams: true } } } });
  if (!a) throw new ActorError(404, "Person not found");
  if (a._count.tasks + a._count.workstreams > 0) throw new ActorError(409, "Still owns tasks or workstreams — merge them into someone else first");
  await tx.actor.delete({ where: { id } });
}

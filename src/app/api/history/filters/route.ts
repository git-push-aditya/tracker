import { authorize } from "@/lib/auth";
import { isDemoMode } from "@/lib/data-source";
import { handle } from "@/lib/http";
import { prisma } from "@/lib/prisma";

// Options for the History filter dropdowns, kept out of the main request so the table doesn't wait on them.
export const GET = handle(async (req) => {
  await authorize(req, "dashboard:read");
  if (isDemoMode()) return Response.json({ workstreams: [], owners: [] });
  const db = prisma();
  const [ws, owners] = await Promise.all([
    db.taskEvent.findMany({ distinct: ["workstreamId"], orderBy: { at: "desc" }, select: { workstreamId: true, workstreamName: true } }),
    db.taskEvent.findMany({ distinct: ["ownerId"], where: { ownerId: { not: null } }, orderBy: { owner: "asc" }, select: { ownerId: true, owner: true } }),
  ]);
  return Response.json({ workstreams: ws.map((w) => ({ id: w.workstreamId, name: w.workstreamName })), owners: owners.map((o) => ({ id: o.ownerId!, name: o.owner })) });
});

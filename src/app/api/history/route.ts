import type { Prisma } from "@/generated/prisma/client";
import { authorize } from "@/lib/auth";
import { isDemoMode } from "@/lib/data-source";
import { handle } from "@/lib/http";
import { prisma } from "@/lib/prisma";

const PAGE = 50;

// GET /api/history?workstream=&owner=&type=COMPLETED|DELETED&cursor=<event id>
export const GET = handle(async (req) => {
  await authorize(req, "dashboard:read");
  if (isDemoMode()) return Response.json({ demo: true, events: [], nextCursor: null, workstreams: [], owners: [] });
  const q = req.nextUrl.searchParams;
  const type = q.get("type");
  const where: Prisma.TaskEventWhereInput = {
    ...(q.get("workstream") && { workstreamId: q.get("workstream")! }),
    ...(q.get("owner") && { owner: q.get("owner")! }),
    ...(type === "COMPLETED" || type === "DELETED" ? { type } : {}),
  };
  const db = prisma();
  const cursor = q.get("cursor");
  const [rows, ws, owners] = await Promise.all([
    db.taskEvent.findMany({ where, orderBy: [{ at: "desc" }, { id: "desc" }], take: PAGE + 1, ...(cursor && { cursor: { id: cursor }, skip: 1 }) }),
    db.taskEvent.findMany({ distinct: ["workstreamId"], orderBy: { at: "desc" }, select: { workstreamId: true, workstreamName: true } }),
    db.taskEvent.findMany({ distinct: ["owner"], where: { owner: { not: "" } }, orderBy: { owner: "asc" }, select: { owner: true } }),
  ]);
  const page = rows.slice(0, PAGE);
  return Response.json({
    events: page.map((e) => ({ ...e, at: e.at.toISOString() })),
    nextCursor: rows.length > PAGE ? page[page.length - 1].id : null,
    workstreams: ws.map((w) => ({ id: w.workstreamId, name: w.workstreamName })),
    owners: owners.map((o) => o.owner),
  });
});

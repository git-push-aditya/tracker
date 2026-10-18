import { authorize } from "@/lib/auth";
import { toWorkstream, workstreamInclude } from "@/lib/data-source";
import { ownerColumns } from "@/lib/actors";
import { handle, parseBody } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { WorkstreamInput } from "@/lib/schemas";

export const POST = handle(async (req) => {
  await authorize(req, "workstream:create");
  const data = await parseBody(req, WorkstreamInput);
  const ws = await prisma().$transaction(async (tx) => {
    const max = await tx.workstream.aggregate({ _max: { position: true } });
    return tx.workstream.create({ data: { ...data, ...(await ownerColumns(tx, data.owner)), position: (max._max.position ?? -1) + 1 }, include: workstreamInclude });
  });
  return Response.json(toWorkstream(ws), { status: 201 });
});

import { authorize, clearSessionCookie } from "@/lib/auth";
import { handle } from "@/lib/http";
import { prisma } from "@/lib/prisma";

export const POST = handle(async (req) => {
  const s = (await authorize(req, null, { allowMustChange: true }))!;
  await prisma().session.deleteMany({ where: { id: s.sessionId } });
  await clearSessionCookie();
  return Response.json({ ok: true });
});

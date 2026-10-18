import { getSession, meResponse } from "@/lib/auth";
import { isDemoMode } from "@/lib/data-source";
import { handle, HttpError } from "@/lib/http";

export const GET = handle(async () => {
  if (isDemoMode()) return Response.json({ demo: true });
  const s = await getSession();
  if (!s) throw new HttpError(401, "Not signed in");
  return Response.json(meResponse(s));
});

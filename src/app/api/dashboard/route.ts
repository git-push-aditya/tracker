import { authorize } from "@/lib/auth";
import { getDashboard } from "@/lib/data-source";
import { handle } from "@/lib/http";

export const GET = handle(async (req) => {
  await authorize(req, "dashboard:read"); // no session in demo mode
  return Response.json(await getDashboard());
});

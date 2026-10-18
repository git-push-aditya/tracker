import { connection, type NextRequest } from "next/server";
import { ZodError, type ZodType } from "zod";
import { DatabaseUnavailableError } from "./data-source";

export class HttpError extends Error {
  constructor(readonly status: number, message: string, readonly code?: string) {
    super(message);
  }
}

const isPrismaCode = (e: unknown, ...codes: string[]) =>
  typeof e === "object" && e !== null && "code" in e && codes.includes((e as { code: string }).code);

// Connection failures: Prisma reports P1001/P1002/P1008/P1017 (the old Neon websocket driver threw a bare Event).
export const isConnectionError = (e: unknown) =>
  (typeof Event !== "undefined" && e instanceof Event) ||
  isPrismaCode(e, "P1001", "P1002", "P1008", "P1017") ||
  (e instanceof Error && e.name === "PrismaClientInitializationError");

export async function parseBody<T>(req: Request, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new HttpError(400, "Body must be valid JSON");
  }
  return schema.parse(raw);
}

// Wraps a route handler: maps thrown errors to the status codes in the plan (400/401/403/404/409/503).
export function handle<C = unknown>(fn: (req: NextRequest, ctx: C) => Promise<Response>) {
  return async (req: NextRequest, ctx: C): Promise<Response> => {
    await connection(); // request-time only: never prerender an API response (Cache Components is on)
    for (let attempt = 0; ; attempt++) {
      try {
        return await fn(req, ctx);
      } catch (e) {
        // reads retry once (covers a transient connection failure); writes don't, they may have partly run
        if (isConnectionError(e) && req.method === "GET" && !attempt) continue;
        return toResponse(e);
      }
    }
  };
}

function toResponse(e: unknown): Response {
  if (e instanceof HttpError) return Response.json({ error: e.message, code: e.code }, { status: e.status });
  if (e instanceof ZodError) return Response.json({ error: "Invalid input", issues: e.issues }, { status: 400 });
  if (e instanceof DatabaseUnavailableError || isConnectionError(e)) return Response.json({ error: "Database unreachable" }, { status: 503 });
  if (isPrismaCode(e, "P2002")) return Response.json({ error: "Already exists" }, { status: 409 });
  if (isPrismaCode(e, "P2025")) return Response.json({ error: "Not found" }, { status: 404 });
  console.error(e);
  return Response.json({ error: "Internal error" }, { status: 500 });
}

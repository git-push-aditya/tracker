// Browser-side fetch wrapper for our own API.
export class ApiError extends Error {
  constructor(readonly status: number, message: string, readonly code?: string) {
    super(message);
  }
}

export async function api<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, "Couldn't reach the server");
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const issue = data?.issues?.[0]; // Zod rejection → "field: message"
    throw new ApiError(res.status, issue ? `${issue.path?.join(".") || "input"}: ${issue.message}` : data?.error ?? res.statusText, data?.code);
  }
  return data as T;
}

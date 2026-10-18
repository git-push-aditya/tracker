"use client";
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { lazy, Suspense, useState } from "react";
import { ApiError } from "@/lib/api";
import { emitToast } from "@/lib/toast";

const Devtools = lazy(() => import("@tanstack/react-query-devtools").then((m) => ({ default: m.ReactQueryDevtools })));

// Global handling for every query and mutation (plan 5.3):
//   401 → drop the cache, /login · 403 PASSWORD_CHANGE_REQUIRED → /change-password · other 403 → toast
/* eslint-disable @next/next/no-location-assign-relative-destination -- hard navigation on purpose: it also drops all in-memory state */
function make() {
  const onError = (e: unknown) => {
    if (!(e instanceof ApiError)) return;
    if (e.status === 401) { client.clear(); window.location.href = "/login"; }
    else if (e.status === 403 && e.code === "PASSWORD_CHANGE_REQUIRED") window.location.href = "/change-password";
    else if (e.status === 403) emitToast("You don't have permission to do that");
  };
  const client: QueryClient = new QueryClient({ queryCache: new QueryCache({ onError }), mutationCache: new MutationCache({ onError }) });
  return client;
}
/* eslint-enable @next/next/no-location-assign-relative-destination */

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(make);
  return (
    <QueryClientProvider client={client}>
      {children}
      {process.env.NODE_ENV === "development" && <Suspense><Devtools buttonPosition="bottom-left" /></Suspense>}
    </QueryClientProvider>
  );
}

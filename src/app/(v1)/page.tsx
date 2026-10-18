import { dehydrate, HydrationBoundary, QueryClient } from "@tanstack/react-query";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { DashboardApp } from "@/components/DashboardApp";
import { RetryError } from "@/components/RetryError";
import { meResponse, sessionOrDown } from "@/lib/auth";
import { getDashboard, isDemoMode } from "@/lib/data-source";

// Routing guard (plan 5.2) + prefetch: the page asks getDashboard() directly (not over HTTP) and hands the
// result to the client cache, so there is no loading flash. The session read must sit behind <Suspense>.
async function Gate() {
  const qc = new QueryClient();
  if (isDemoMode()) qc.setQueryData(["me"], { demo: true });
  else {
    const s = await sessionOrDown();
    if (s === "down") return <RetryError />;
    if (!s) redirect("/login");
    if (s.user.mustChangePassword) redirect("/change-password");
    qc.setQueryData(["me"], meResponse(s));
  }
  // an unreachable DB leaves "dashboard" out of the cache; the client then fetches and shows the error panel
  await qc.prefetchQuery({ queryKey: ["dashboard"], queryFn: getDashboard });
  return (
    <HydrationBoundary state={dehydrate(qc)}>
      <DashboardApp />
    </HydrationBoundary>
  );
}

export default function Home() {
  return (
    <Suspense>
      <Gate />
    </Suspense>
  );
}

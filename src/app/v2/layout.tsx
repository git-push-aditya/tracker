import { dehydrate, HydrationBoundary, QueryClient } from "@tanstack/react-query";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { DashboardApp } from "@/components/v2/DashboardApp";
import { RetryError } from "@/components/RetryError";
import { meResponse, sessionOrDown } from "@/lib/auth";
import { getDashboard, isDemoMode } from "@/lib/data-source";
import "./v2.css";

// Same routing guard + prefetch as the v1 home page, but once for all /v2 views.
async function Gate({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient();
  if (isDemoMode()) qc.setQueryData(["me"], { demo: true });
  else {
    const s = await sessionOrDown();
    if (s === "down") return <RetryError />;
    if (!s) redirect("/login");
    if (s.user.mustChangePassword) redirect("/change-password");
    qc.setQueryData(["me"], meResponse(s));
  }
  await qc.prefetchQuery({ queryKey: ["dashboard"], queryFn: getDashboard });
  return (
    <HydrationBoundary state={dehydrate(qc)}>
      <DashboardApp />
      {children}
    </HydrationBoundary>
  );
}

export default function V2Layout({ children }: LayoutProps<"/v2">) {
  return (
    <Suspense>
      <Gate>{children}</Gate>
    </Suspense>
  );
}

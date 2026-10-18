import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AuthCard, ChangePasswordForm } from "@/components/Auth";
import { RetryError } from "@/components/RetryError";
import { sessionOrDown } from "@/lib/auth";
import { isDemoMode } from "@/lib/data-source";

async function Gate() {
  if (isDemoMode()) redirect("/");
  const s = await sessionOrDown();
  if (s === "down") return <RetryError />;
  if (!s) redirect("/login");
  return (
    <AuthCard title="Change password">
      <ChangePasswordForm />
    </AuthCard>
  );
}

export default function ChangePasswordPage() {
  return (
    <Suspense>
      <Gate />
    </Suspense>
  );
}

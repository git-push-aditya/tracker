import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AuthCard, LoginForm } from "@/components/Auth";
import { sessionOrDown } from "@/lib/auth";
import { isDemoMode } from "@/lib/data-source";

async function Gate() {
  if (isDemoMode()) redirect("/"); // no users in demo mode
  const s = await sessionOrDown();
  if (s && s !== "down") redirect(s.user.mustChangePassword ? "/change-password" : "/");
  // signed out, or DB unreachable: show the form; submitting reports the error
  return (
    <AuthCard title="Sign in">
      <LoginForm />
    </AuthCard>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <Gate />
    </Suspense>
  );
}

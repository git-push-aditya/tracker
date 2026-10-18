"use client";
import { Logo } from "./ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { LoginInput, PasswordChange } from "@/lib/schemas";

export function AuthCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="auth-wrap">
      <div className="panel auth-card">
        <div className="brand">
          <div className="logo" aria-hidden="true">
            <Logo />
          </div>
          <div>
            <h1>Prime Care</h1>
            <div className="sub">{title}</div>
          </div>
        </div>
        {children}
      </div>
    </main>
  );
}

// Validate with the shared Zod schemas, show an error line, disable the button while submitting.
function useSubmit(validate: (f: FormData) => string | null, send: (f: FormData) => Promise<string>) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const msg = validate(new FormData(form));
    setError(msg ?? "");
    if (msg) return;
    setBusy(true);
    try {
      router.replace(await send(new FormData(form)));
      router.refresh(); // re-run the server guards with the new session
    } catch (err) {
      setBusy(false);
      if (err instanceof ApiError && err.status === 401 && form.dataset.expires) return void router.replace("/login");
      setError(err instanceof ApiError ? (err.status === 429 ? "Too many attempts, try again in 15 minutes" : err.message) : "Something went wrong");
    }
  };
  return { error, busy, onSubmit };
}

// Password field with a show/hide toggle (eye button)
function PasswordInput(props: React.ComponentProps<"input">) {
  const [shown, setShown] = useState(false);
  return (
    <span className="pw">
      <input {...props} type={shown ? "text" : "password"} />
      <button type="button" className="pw-toggle" aria-label={shown ? "Hide password" : "Show password"} aria-pressed={shown} onClick={() => setShown((v) => !v)}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z" />
          <circle cx="12" cy="12" r="3" />
          {shown && <path d="M3 3l18 18" />}
        </svg>
      </button>
    </span>
  );
}

const get = (f: FormData, k: string) => String(f.get(k) ?? "");

export function LoginForm() {
  const { error, busy, onSubmit } = useSubmit((f) => {
    const r = LoginInput.safeParse({ username: get(f, "username"), password: get(f, "password") });
    return r.success ? null : "Enter your username and password.";
  }, async (f) => {
    const r = await api<{ mustChangePassword: boolean }>("POST", "/api/auth/login", { username: get(f, "username"), password: get(f, "password") });
    return r.mustChangePassword ? "/change-password" : "/";
  });
  return (
    <form className="auth-form" noValidate onSubmit={onSubmit}>
      <label className="field">Username<input name="username" autoComplete="username" autoCapitalize="none" required /></label>
      <label className="field">Password<PasswordInput name="password" autoComplete="current-password" required /></label>
      <div className="err" role="alert" aria-live="polite">{error}</div>
      <button className="btn primary" type="submit" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
    </form>
  );
}

export function ChangePasswordForm() {
  const { error, busy, onSubmit } = useSubmit((f) => {
    if (!get(f, "currentPassword") || !get(f, "newPassword")) return "Fill in all the fields.";
    const r = PasswordChange.safeParse({ currentPassword: get(f, "currentPassword"), newPassword: get(f, "newPassword") });
    if (!r.success) return r.error.issues[0].message;
    return get(f, "newPassword") === get(f, "confirmPassword") ? null : "The new passwords don't match.";
  }, async (f) => {
    await api("PATCH", "/api/auth/password", { currentPassword: get(f, "currentPassword"), newPassword: get(f, "newPassword") });
    return "/";
  });
  return (
    <form className="auth-form" noValidate onSubmit={onSubmit} data-expires>
      <p className="help">Choose a new password (at least 10 characters) to continue.</p>
      <label className="field">Current password<PasswordInput name="currentPassword" autoComplete="current-password" required /></label>
      <label className="field">New password<PasswordInput name="newPassword" autoComplete="new-password" required minLength={10} /></label>
      <label className="field">Confirm new password<PasswordInput name="confirmPassword" autoComplete="new-password" required /></label>
      <div className="err" role="alert" aria-live="polite">{error}</div>
      <button className="btn primary" type="submit" disabled={busy}>{busy ? "Saving…" : "Change password"}</button>
    </form>
  );
}

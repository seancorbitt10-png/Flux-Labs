"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { requestPasswordReset, resetPassword, type ResetResult } from "@/lib/auth/password-reset-actions";

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState<ResetResult | null, FormData>(requestPasswordReset, null);
  return <form action={action} className="space-y-4">
    <Input label="Email" name="email" type="email" autoComplete="email" required />
    {state ? <p role="status" className="text-sm text-muted">{state.message}</p> : null}
    <Button type="submit" disabled={pending} className="w-full">{pending ? "Sending…" : "Send reset link"}</Button>
    <p className="text-sm text-muted"><Link href="/login" className="font-semibold underline">Back to sign in</Link></p>
  </form>;
}

export const PASSWORD_RESET_SUCCESS_PATH = "/login?reset=success";
const SUCCESS_REDIRECT_DELAY_MS = 1800;

export function ResetPasswordForm({ token, email }: { token: string; email: string }) {
  const router = useRouter();
  const [state, action, pending] = useActionState<ResetResult | null, FormData>(resetPassword, null);
  const succeeded = state?.ok === true;

  useEffect(() => {
    if (!succeeded) return;
    const timer = window.setTimeout(() => router.replace(PASSWORD_RESET_SUCCESS_PATH), SUCCESS_REDIRECT_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [succeeded, router]);

  if (succeeded) {
    return <div className="space-y-4">
      <p role="status" className="text-sm font-medium text-foreground">{state.message}</p>
      <p className="text-sm text-muted">Taking you to sign in…</p>
      <Link href={PASSWORD_RESET_SUCCESS_PATH} className="block text-sm font-semibold underline">Go to sign in</Link>
    </div>;
  }

  return <form action={action} className="space-y-4">
    <input type="hidden" name="token" value={token} />
    <input type="hidden" name="email" value={email} />
    <Input label="New password" name="password" type="password" autoComplete="new-password" minLength={8} maxLength={72} required />
    <Input label="Confirm new password" name="confirmPassword" type="password" autoComplete="new-password" minLength={8} maxLength={72} required />
    {state ? <p role="alert" className="text-sm text-danger">{state.message}</p> : null}
    <Button type="submit" disabled={pending} className="w-full">{pending ? "Updating…" : "Update password"}</Button>
    <p className="text-sm text-muted">Link not working? <Link href="/forgot-password" className="font-semibold underline">Request a new one</Link></p>
  </form>;
}

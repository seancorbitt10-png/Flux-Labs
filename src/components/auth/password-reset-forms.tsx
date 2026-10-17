"use client";

import Link from "next/link";
import { useActionState } from "react";
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

export function ResetPasswordForm({ token, email }: { token: string; email: string }) {
  const [state, action, pending] = useActionState<ResetResult | null, FormData>(resetPassword, null);
  return <form action={action} className="space-y-4">
    <input type="hidden" name="token" value={token} />
    <input type="hidden" name="email" value={email} />
    <Input label="New password" name="password" type="password" autoComplete="new-password" minLength={8} maxLength={72} required />
    {state ? <p role={state.ok ? "status" : "alert"} className="text-sm text-muted">{state.message}</p> : null}
    {state?.ok ? <Link href="/login" className="block text-sm font-semibold underline">Go to sign in</Link> : <Button type="submit" disabled={pending} className="w-full">{pending ? "Updating…" : "Update password"}</Button>}
  </form>;
}

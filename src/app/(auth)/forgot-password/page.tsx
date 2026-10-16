import Link from "next/link";
import { ForgotPasswordForm } from "@/components/auth/password-reset-forms";

export const metadata = { title: "Forgot password" };

export default function ForgotPasswordPage() {
  return (
    <div className="relative flex min-h-screen items-center justify-center bg-canvas px-4">
      <div className="pointer-events-none absolute inset-0 bg-atmosphere" />
      <div className="relative w-full max-w-md space-y-6 rounded-xl border border-foreground/10 bg-surface p-6">
        <div>
          <p className="text-xl font-bold tracking-tight">Flux Labs</p>
          <h1 className="mt-2 text-lg font-semibold">Reset your password</h1>
          <p className="mt-1 text-sm font-medium text-muted">
            Enter the email address associated with your account and we’ll send a reset link if an account exists.
          </p>
        </div>
        <ForgotPasswordForm />
      </div>
    </div>
  );
}

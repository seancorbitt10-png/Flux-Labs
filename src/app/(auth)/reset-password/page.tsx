import Link from "next/link";
import { ResetPasswordForm } from "@/components/auth/password-reset-forms";
import { isPlausibleEmail } from "@/lib/auth/password-reset-validation";

export const metadata = {
  title: "Choose a new password",
  robots: { index: false, follow: false },
  referrer: "no-referrer" as const,
};

type ResetPasswordPageProps = {
  searchParams: Promise<{ token?: string; email?: string }>;
};

export default async function ResetPasswordPage({ searchParams }: ResetPasswordPageProps) {
  const params = await searchParams;
  const token = params.token ?? "";
  const email = (params.email ?? "").trim().toLowerCase();
  const linkUsable = Boolean(token) && isPlausibleEmail(email);

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-canvas px-4">
      <div className="pointer-events-none absolute inset-0 bg-atmosphere" />
      <div className="relative w-full max-w-md space-y-6 rounded-xl border border-foreground/10 bg-surface p-6">
        <div>
          <p className="text-xl font-bold tracking-tight">Flux Labs</p>
          <h1 className="mt-2 text-lg font-semibold">Choose a new password</h1>
          <p className="mt-1 text-sm font-medium text-muted">
            Reset links expire after 30 minutes and can only be used once.
          </p>
        </div>
        {linkUsable ? (
          <ResetPasswordForm token={token} email={email} />
        ) : (
          <div className="space-y-4">
            <p role="alert" className="text-sm text-danger">
              This reset link is invalid or incomplete. Request a new one.
            </p>
            <Link href="/forgot-password" className="block text-sm font-semibold underline">
              Request a new reset link
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

import { ResetPasswordForm } from "@/components/auth/password-reset-forms";

export const metadata = { title: "Choose a new password" };

type ResetPasswordPageProps = {
  searchParams: Promise<{ token?: string; email?: string }>;
};

export default async function ResetPasswordPage({ searchParams }: ResetPasswordPageProps) {
  const params = await searchParams;
  const token = params.token ?? "";
  const email = params.email ?? "";

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
        <ResetPasswordForm token={token} email={email} />
      </div>
    </div>
  );
}

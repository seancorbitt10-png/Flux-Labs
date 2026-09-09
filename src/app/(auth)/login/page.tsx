import Link from "next/link";
import { LoginForm } from "@/components/auth/auth-forms";

export const metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <div className="relative flex min-h-screen items-center justify-center bg-canvas px-4">
      <div className="pointer-events-none absolute inset-0 bg-atmosphere" />
      <div className="relative w-full max-w-md space-y-6 rounded-xl border border-foreground/10 bg-surface p-6">
        <div>
          <p className="text-xl font-bold tracking-tight">Flux Labs</p>
          <h1 className="mt-2 text-lg font-semibold">Sign in</h1>
          <p className="mt-1 text-sm font-medium text-muted">
            Continue to your academic workspace.
          </p>
        </div>
        <LoginForm />
        <p className="text-sm font-medium text-muted">
          No account?{" "}
          <Link
            href="/register"
            className="font-semibold text-accent underline-offset-2 hover:underline"
          >
            Create one
          </Link>
        </p>
      </div>
    </div>
  );
}

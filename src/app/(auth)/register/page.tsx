import Link from "next/link";
import { RegisterForm } from "@/components/auth/auth-forms";

export const metadata = { title: "Create account" };

export default function RegisterPage() {
  return (
    <div className="relative flex min-h-screen items-center justify-center bg-canvas px-4">
      <div className="pointer-events-none absolute inset-0 bg-atmosphere" />
      <div className="relative w-full max-w-md space-y-6 rounded-xl border border-foreground/10 bg-surface p-6">
        <div>
          <p className="text-xl font-bold tracking-tight">Flux Labs</p>
          <h1 className="mt-2 text-lg font-semibold">Create your account</h1>
          <p className="mt-1 text-sm font-medium text-muted">
            Start a controlled trial of the academic operating system.
          </p>
        </div>
        <RegisterForm />
        <p className="text-sm font-medium text-muted">
          Already have an account?{" "}
          <Link
            href="/login"
            className="font-semibold text-accent underline-offset-2 hover:underline"
          >
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}

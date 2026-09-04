import Link from "next/link";
import { LoginForm } from "@/components/auth/auth-forms";

export const metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <div className="relative flex min-h-screen items-center justify-center bg-canvas px-4">
      <div className="pointer-events-none absolute inset-0 bg-atmosphere" />
      <div className="relative w-full max-w-md space-y-6 rounded-xl border border-foreground/10 bg-background/80 p-6 shadow-sm backdrop-blur">
        <div>
          <p className="font-display text-2xl">Flux Labs</p>
          <h1 className="mt-2 text-lg font-medium">Sign in</h1>
          <p className="mt-1 text-sm text-foreground/60">
            Continue to your academic workspace.
          </p>
        </div>
        <LoginForm />
        <p className="text-sm text-foreground/60">
          No account?{" "}
          <Link href="/register" className="underline underline-offset-2">
            Create one
          </Link>
        </p>
      </div>
    </div>
  );
}

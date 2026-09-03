import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { Button } from "@/components/ui/button";

export default async function LandingPage() {
  const session = await auth();
  if (session?.user) {
    redirect("/home");
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-canvas text-foreground">
      <div className="pointer-events-none absolute inset-0 bg-atmosphere" />
      <header className="relative mx-auto flex max-w-6xl items-center justify-between px-4 py-5 sm:px-6">
        <p className="font-display text-2xl tracking-tight">Flux Labs</p>
        <div className="flex items-center gap-2">
          <Link href="/login">
            <Button variant="ghost">Sign in</Button>
          </Link>
          <Link href="/register">
            <Button>Get started</Button>
          </Link>
        </div>
      </header>

      <main className="relative mx-auto flex max-w-6xl flex-col px-4 pb-20 pt-16 sm:px-6 sm:pt-24">
        <p className="animate-fade-up font-display text-5xl leading-[1.05] tracking-tight sm:text-7xl">
          Flux Labs
        </p>
        <h1 className="animate-fade-up-delay mt-6 max-w-2xl text-xl leading-relaxed text-foreground/75 sm:text-2xl">
          Your persistent academic intelligence layer — learn, plan, and
          improve with AI that guides instead of doing the work.
        </h1>
        <div className="animate-fade-up-delay mt-10 flex flex-wrap gap-3">
          <Link href="/register">
            <Button className="min-w-36">Start your trial</Button>
          </Link>
          <Link href="/login">
            <Button variant="secondary" className="min-w-36">
              Sign in
            </Button>
          </Link>
        </div>
      </main>
    </div>
  );
}

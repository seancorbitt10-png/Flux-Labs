"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SidebarNav } from "./sidebar-nav";
import { MobileNav } from "./mobile-nav";

export function AppShell({
  children,
  userName,
}: {
  children: React.ReactNode;
  userName?: string | null;
}) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-canvas text-foreground">
      <div className="pointer-events-none fixed inset-0 -z-10 bg-atmosphere" />
      <MobileNav />
      <div className="mx-auto flex min-h-screen max-w-7xl">
        <aside className="hidden w-60 shrink-0 flex-col border-r border-foreground/10 bg-surface/40 px-4 py-6 lg:flex">
          <Link
            href="/home"
            className="mb-8 text-lg font-bold tracking-tight text-foreground"
          >
            Flux Labs
          </Link>
          <SidebarNav pathname={pathname} />
          <div className="mt-auto border-t border-foreground/10 pt-4 text-xs font-medium text-muted">
            {userName ? (
              <p className="truncate text-foreground/80">{userName}</p>
            ) : null}
            <p className="mt-1 text-foreground/45">Flux Labs</p>
          </div>
        </aside>
        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-10">{children}</main>
      </div>
    </div>
  );
}

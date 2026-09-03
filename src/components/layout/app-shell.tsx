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
        <aside className="hidden w-56 shrink-0 flex-col border-r border-foreground/10 px-4 py-6 lg:flex">
          <Link
            href="/home"
            className="font-display mb-8 text-2xl tracking-tight"
          >
            Flux Labs
          </Link>
          <SidebarNav pathname={pathname} />
          <div className="mt-auto border-t border-foreground/10 pt-4 text-xs text-foreground/55">
            {userName ? <p className="truncate">{userName}</p> : null}
            <p className="mt-1">Academic OS · Phase 1</p>
          </div>
        </aside>
        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-10">{children}</main>
      </div>
    </div>
  );
}

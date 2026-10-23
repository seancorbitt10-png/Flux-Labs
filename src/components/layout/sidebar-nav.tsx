"use client";

import Link from "next/link";
import { accountNavItems, navItems } from "@/components/layout/nav-config";

function navLinkClass(active: boolean) {
  return [
    "rounded-lg px-3 py-2.5 text-sm font-semibold tracking-tight transition-colors",
    active
      ? "bg-accent-soft text-accent"
      : "text-foreground/65 hover:bg-foreground/5 hover:text-foreground",
  ].join(" ");
}

export function SidebarNav({ pathname }: { pathname: string }) {
  return (
    <div className="flex flex-1 flex-col">
      <nav className="flex flex-col gap-0.5" aria-label="Primary">
        {navItems.map((item) => {
          const active =
            pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={navLinkClass(active)}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      <nav
        className="mt-auto flex flex-col gap-0.5 border-t border-foreground/10 pt-4"
        aria-label="Account"
      >
        {accountNavItems.map((item) => {
          const active =
            pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={navLinkClass(active)}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

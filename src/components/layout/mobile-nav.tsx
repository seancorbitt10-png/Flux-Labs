"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { accountNavItems, navItems } from "./nav-config";

function navLinkClass(active: boolean) {
  return [
    "rounded-lg px-3 py-2.5 text-sm font-semibold",
    active ? "bg-accent-soft text-accent" : "text-foreground/70",
  ].join(" ");
}

export function MobileNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <div className="border-b border-foreground/10 bg-surface/60 backdrop-blur-sm lg:hidden">
      <div className="flex items-center justify-between px-4 py-3">
        <Link
          href="/home"
          className="text-base font-bold tracking-tight text-foreground"
        >
          Flux Labs
        </Link>
        <button
          type="button"
          className="min-h-10 rounded-lg border border-foreground/15 bg-surface px-3 py-1.5 text-sm font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls="mobile-nav"
        >
          {open ? "Close" : "Menu"}
        </button>
      </div>
      {open ? (
        <nav
          id="mobile-nav"
          className="flex flex-col gap-0.5 px-3 pb-3"
          aria-label="Mobile navigation"
        >
          {navItems.map((item) => {
            const active =
              pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className={navLinkClass(active)}
              >
                {item.label}
              </Link>
            );
          })}
          <div className="mt-2 border-t border-foreground/10 pt-2">
            {accountNavItems.map((item) => {
              const active =
                pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className={`${navLinkClass(active)} block`}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>
        </nav>
      ) : null}
    </div>
  );
}

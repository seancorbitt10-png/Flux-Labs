"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { navItems } from "./nav-config";

export function MobileNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <div className="border-b border-foreground/10 lg:hidden">
      <div className="flex items-center justify-between px-4 py-3">
        <Link href="/home" className="font-display text-xl tracking-tight">
          Flux Labs
        </Link>
        <button
          type="button"
          className="rounded-md border border-foreground/15 px-3 py-1.5 text-sm"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="mobile-nav"
        >
          {open ? "Close" : "Menu"}
        </button>
      </div>
      {open ? (
        <nav
          id="mobile-nav"
          className="flex flex-col gap-1 px-3 pb-3"
          aria-label="Mobile primary"
        >
          {navItems.map((item) => {
            const active =
              pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className={[
                  "rounded-md px-3 py-2 text-sm",
                  active
                    ? "bg-foreground text-background"
                    : "text-foreground/70",
                ].join(" ")}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      ) : null}
    </div>
  );
}

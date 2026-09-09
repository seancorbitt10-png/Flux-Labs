import { navItems } from "@/components/layout/nav-config";
import Link from "next/link";

export function SidebarNav({ pathname }: { pathname: string }) {
  return (
    <nav className="flex flex-col gap-0.5" aria-label="Primary">
      {navItems.map((item) => {
        const active =
          pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={[
              "rounded-lg px-3 py-2.5 text-sm font-semibold tracking-tight transition-colors",
              active
                ? "bg-accent-soft text-accent"
                : "text-foreground/65 hover:bg-foreground/5 hover:text-foreground",
            ].join(" ")}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

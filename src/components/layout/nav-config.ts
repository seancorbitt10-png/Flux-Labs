export const navItems = [
  { href: "/home", label: "Home" },
  { href: "/classes", label: "Classes" },
  { href: "/tasks", label: "Tasks" },
  { href: "/calendar", label: "Calendar" },
  { href: "/study", label: "Study" },
  { href: "/resources", label: "Resources" },
  { href: "/progress", label: "Progress" },
  { href: "/settings", label: "Settings" },
] as const;

export type NavItem = (typeof navItems)[number];

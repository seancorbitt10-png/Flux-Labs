export const navItems = [
  { href: "/home", label: "Home" },
  { href: "/image", label: "Image" },
  { href: "/video", label: "Video" },
  { href: "/podcast", label: "Podcast" },
  { href: "/history", label: "History" },
] as const;

export const accountNavItems = [
  { href: "/profile", label: "Profile" },
  { href: "/settings", label: "Settings" },
] as const;

export type NavItem = (typeof navItems)[number];
export type AccountNavItem = (typeof accountNavItems)[number];

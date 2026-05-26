"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "Dashboard", isActive: (path: string) => path === "/" },
  {
    href: "/prestacao/nova",
    label: "Prestação",
    isActive: (path: string) => path.startsWith("/prestacao"),
  },
  {
    href: "/movimentacoes",
    label: "Movimentações",
    isActive: (path: string) => path.startsWith("/movimentacoes"),
  },
  {
    href: "/pessoas",
    label: "Pessoas",
    isActive: (path: string) => path.startsWith("/pessoas"),
  },
] as const;

export function AppNav() {
  const pathname = usePathname();

  return (
    <nav className="flex items-center gap-1 sm:gap-2" aria-label="Principal">
      {links.map(({ href, label, isActive }) => {
        const active = isActive(pathname);
        return (
          <Link
            key={href}
            href={href}
            className={`rounded-sm px-2 py-1 text-sm transition-colors duration-150 ease-out-quart focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-up-black focus-visible:ring-offset-2 ${
              active
                ? "border-b-2 border-up-yellow font-medium text-up-black"
                : "border-b-2 border-transparent text-muted hover:text-up-black"
            }`}
            aria-current={active ? "page" : undefined}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

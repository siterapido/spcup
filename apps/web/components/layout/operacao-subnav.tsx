"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const prestacaoLinks = [
  { href: "/prestacao/nova", label: "Nova prestação" },
] as const;

const adminLinks = [
  { href: "/admin/diretorios-estaduais", label: "Estaduais" },
  { href: "/admin/diretorios-municipais", label: "Municipais" },
] as const;

export function OperacaoSubnav() {
  const pathname = usePathname();

  if (pathname.startsWith("/prestacao")) {
    return (
      <nav
        className="border-b border-border-default bg-slate-50"
        aria-label="Prestação"
      >
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-6 py-2 text-sm">
          <span className="text-muted">Prestação</span>
          {prestacaoLinks.map(({ href, label }) => {
            const active = pathname === href || pathname.startsWith(`${href}/`);
            return (
              <Link
                key={href}
                href={href}
                className={
                  active
                    ? "font-medium text-up-black underline decoration-up-yellow decoration-2 underline-offset-4"
                    : "text-muted hover:text-up-black"
                }
              >
                {label}
              </Link>
            );
          })}
        </div>
      </nav>
    );
  }

  if (pathname.startsWith("/admin")) {
    return (
      <nav className="border-b border-border-default bg-slate-50" aria-label="Admin">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-6 py-2 text-sm">
          <span className="text-muted">Administração</span>
          {adminLinks.map(({ href, label }) => {
            const active = pathname === href || pathname.startsWith(`${href}/`);
            return (
              <Link
                key={href}
                href={href}
                className={
                  active
                    ? "font-medium text-up-black underline decoration-up-yellow decoration-2 underline-offset-4"
                    : "text-muted hover:text-up-black"
                }
              >
                {label}
              </Link>
            );
          })}
        </div>
      </nav>
    );
  }

  return null;
}

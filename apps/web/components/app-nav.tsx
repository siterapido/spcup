"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "Dashboard", isActive: (path: string) => path === "/" },
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

function navLinkClass(active: boolean) {
  return `rounded-sm px-2 py-1 text-sm transition-colors duration-150 ease-out-quart focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-up-black focus-visible:ring-offset-2 ${
    active
      ? "border-b-2 border-up-yellow font-medium text-up-black"
      : "border-b-2 border-transparent text-muted hover:text-up-black"
  }`;
}

export function AppNav() {
  const pathname = usePathname();
  const prestacaoActive = pathname.startsWith("/prestacao");
  const adminActive = pathname.startsWith("/admin");

  return (
    <nav className="flex flex-wrap items-center gap-1 sm:gap-2" aria-label="Principal">
      {links.map(({ href, label, isActive }) => {
        const active = isActive(pathname);
        return (
          <Link key={href} href={href} className={navLinkClass(active)} aria-current={active ? "page" : undefined}>
            {label}
          </Link>
        );
      })}

      <details className="relative">
        <summary
          className={`cursor-pointer list-none rounded-sm px-2 py-1 text-sm marker:content-none ${navLinkClass(prestacaoActive)}`}
        >
          Prestação
        </summary>
        <div className="absolute left-0 top-full z-20 mt-1 min-w-[10rem] rounded-md border border-border-default bg-white py-1 shadow-md">
          <Link
            href="/prestacao/nova"
            className="block px-3 py-2 text-sm hover:bg-slate-50"
          >
            Nova prestação
          </Link>
        </div>
      </details>

      <details className="relative">
        <summary
          className={`cursor-pointer list-none rounded-sm px-2 py-1 text-sm marker:content-none ${navLinkClass(adminActive)}`}
        >
          Admin
        </summary>
        <div className="absolute left-0 top-full z-20 mt-1 min-w-[12rem] rounded-md border border-border-default bg-white py-1 shadow-md">
          <Link
            href="/admin/diretorios-estaduais"
            className="block px-3 py-2 text-sm hover:bg-slate-50"
          >
            Diretórios estaduais
          </Link>
          <Link
            href="/admin/diretorios-municipais"
            className="block px-3 py-2 text-sm hover:bg-slate-50"
          >
            Diretórios municipais
          </Link>
        </div>
      </details>
    </nav>
  );
}

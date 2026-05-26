import Link from "next/link";

import { SignOutButton } from "@/components/sign-out-button";

export function AppHeader({ email }: { email?: string | null }) {
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link href="/" className="text-lg font-semibold tracking-tight">
          SPC UP
        </Link>
        <nav className="flex items-center gap-4 text-sm">
          <Link href="/" className="text-slate-600 hover:text-slate-900">
            Dashboard
          </Link>
          <Link href="/movimentacoes" className="text-slate-600 hover:text-slate-900">
            Movimentações
          </Link>
          {email ? (
            <span className="text-slate-500">{email}</span>
          ) : null}
          <SignOutButton />
        </nav>
      </div>
    </header>
  );
}

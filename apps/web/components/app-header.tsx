import Link from "next/link";

import { AppNav } from "@/components/app-nav";
import { SignOutButton } from "@/components/sign-out-button";

export function AppHeader({ email }: { email?: string | null }) {
  return (
    <header className="border-b border-border bg-surface-card">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-4">
        <Link
          href="/"
          className="group flex flex-col focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-up-black focus-visible:ring-offset-2"
        >
          <span className="text-lg font-semibold tracking-tight text-up-black">SPC UP</span>
          <span
            className="mt-0.5 h-0.5 w-8 rounded-full bg-up-yellow transition-[width] duration-150 ease-out-quart group-hover:w-10"
            aria-hidden
          />
        </Link>
        <div className="flex flex-wrap items-center gap-4">
          <AppNav />
          {email ? (
            <span className="hidden text-sm text-muted sm:inline" title={email}>
              {email}
            </span>
          ) : null}
          <SignOutButton />
        </div>
      </div>
    </header>
  );
}

import type { Metadata } from "next";

import { AppHeader } from "@/components/app-header";
import { auth } from "@/auth";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "SPC UP",
  description: "Prestação de contas — dashboard",
  icons: { icon: "/icon.svg" },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await auth();

  return (
    <html lang="pt-BR">
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased">
        <Providers>
          {session?.user ? (
            <AppHeader email={session.user.email} />
          ) : null}
          {children}
        </Providers>
      </body>
    </html>
  );
}

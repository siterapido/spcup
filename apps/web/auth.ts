import { compare } from "bcryptjs";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { getDb, usuario } from "@spc-up/db";
import { eq } from "drizzle-orm";

import { authConfig } from "./auth.config";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  secret: process.env.AUTH_SECRET,
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Senha", type: "password" },
      },
      async authorize(credentials) {
        const email = credentials?.email as string | undefined;
        const password = credentials?.password as string | undefined;
        if (!email || !password) return null;

        const db = getDb();
        const row = await db.query.usuario.findFirst({
          where: eq(usuario.email, email.toLowerCase().trim()),
        });
        if (!row?.ativo) return null;

        const ok = await compare(password, row.passwordHash);
        if (!ok) return null;

        return { id: row.id, email: row.email };
      },
    }),
  ],
});

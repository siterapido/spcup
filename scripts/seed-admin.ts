/**
 * Seed admin usuario: ADMIN_EMAIL + ADMIN_PASSWORD from env.
 * Run: pnpm seed:admin
 */
import { hashPassword } from "../apps/web/lib/password";
import { getDb, usuario } from "@spc-up/db";
import { eq } from "drizzle-orm";

async function main() {
  const email = process.env.ADMIN_EMAIL?.toLowerCase().trim();
  const password = process.env.ADMIN_PASSWORD;

  if (!email || !password) {
    console.error("Defina ADMIN_EMAIL e ADMIN_PASSWORD no ambiente.");
    process.exit(1);
  }

  const db = getDb();
  const passwordHash = await hashPassword(password);

  const existing = await db.query.usuario.findFirst({
    where: eq(usuario.email, email),
  });

  if (existing) {
    await db
      .update(usuario)
      .set({ passwordHash, ativo: true })
      .where(eq(usuario.id, existing.id));
    console.log(`Usuario atualizado: ${email}`);
  } else {
    await db.insert(usuario).values({ email, passwordHash, ativo: true });
    console.log(`Usuario criado: ${email}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

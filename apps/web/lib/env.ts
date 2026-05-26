import { z } from "zod";

const serverEnvSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  AUTH_SECRET: z.string().min(1, "AUTH_SECRET is required"),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | null = null;

function isProductionRuntime(): boolean {
  return (
    process.env.NODE_ENV === "production" &&
    process.env.NEXT_PHASE !== "phase-production-build"
  );
}

function formatEnvErrors(error: z.ZodError): string {
  return error.issues.map((issue) => issue.message).join("; ");
}

/** Validates required server env. Warns in dev; throws in production runtime when missing. */
export function validateServerEnv(): ServerEnv | undefined {
  if (cached) return cached;

  const parsed = serverEnvSchema.safeParse({
    DATABASE_URL: process.env.DATABASE_URL,
    AUTH_SECRET: process.env.AUTH_SECRET,
  });

  if (parsed.success) {
    cached = parsed.data;
    return cached;
  }

  const message = `[env] ${formatEnvErrors(parsed.error)}`;
  if (isProductionRuntime()) {
    throw new Error(message);
  }
  console.warn(message);
  return undefined;
}

export function getServerEnv(): ServerEnv {
  const env = validateServerEnv();
  if (!env) {
    throw new Error("Server env not validated (DATABASE_URL, AUTH_SECRET)");
  }
  return env;
}

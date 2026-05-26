export async function register() {
  const { validateServerEnv } = await import("./lib/env");
  validateServerEnv();
}

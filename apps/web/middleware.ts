import NextAuth from "next-auth";

import { authConfig } from "./auth.config";

export default NextAuth(authConfig).auth;

export const config = {
  matcher: [
    /*
     * Protect all app and API routes; skip static assets and Next internals.
     */
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|.*\\.(?:svg|png|ico|webp)$).*)",
  ],
};

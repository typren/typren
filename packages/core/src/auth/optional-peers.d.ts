/**
 * Minimal ambient shape for the OPTIONAL peer `@clerk/nextjs` so `clerk.ts`
 * type-checks and builds without the lib installed (it's a reference adapter;
 * consumers who wire it install `@clerk/nextjs`, whose real types then win in
 * their own project. This `.d.ts` is a compile-time input, never emitted to
 * `dist`). Only the surface `clerkAuthAdapter` touches is declared.
 *
 * `next-auth` needs no shim: its adapter injects `auth()` and never imports the lib.
 */
declare module "@clerk/nextjs/server" {
  export function auth(): Promise<{ userId: string | null; sessionClaims: unknown }>;
  export function currentUser(): Promise<{
    id: string;
    emailAddresses: Array<{ emailAddress: string }>;
    fullName: string | null;
  } | null>;
}

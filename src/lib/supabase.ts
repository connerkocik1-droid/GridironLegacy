import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

export class NotConfiguredError extends Error {}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new NotConfiguredError(`${name} is not set. Copy .env.example to .env.local.`);
  }
  return value;
}

/** True once the browser-facing Supabase credentials are present. */
export function isConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

// The browser client lives in lib/supabase-browser.ts. It cannot live here:
// this module reads next/headers at import time, and a client component that
// imported it would drag that in and fail to build.

/** Server client bound to the request's cookies, still subject to RLS. */
export async function serverClient() {
  const store = await cookies();
  return createServerClient(
    required("NEXT_PUBLIC_SUPABASE_URL"),
    required("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    {
      cookies: {
        getAll: () => store.getAll(),
        setAll: (list: { name: string; value: string; options?: CookieOptions }[]) => {
          try {
            for (const { name, value, options } of list) store.set(name, value, options);
          } catch {
            // Called from a Server Component, where cookies are read-only.
            // Middleware refreshes the session instead.
          }
        },
      },
    },
  );
}

/**
 * Bypasses row-level security. Server-only, for the ingestion job and the
 * seed script — never import this from anything that reaches the browser.
 */
export function serviceClient() {
  return createClient(required("SUPABASE_URL"), required("SUPABASE_SERVICE_KEY"), {
    auth: { persistSession: false },
  });
}

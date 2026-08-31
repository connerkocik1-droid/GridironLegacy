"use client";

import { createBrowserClient } from "@supabase/ssr";

/**
 * The Supabase client for code running in a browser.
 *
 * Its own file, away from lib/supabase.ts, because that module reads
 * next/headers at import time — which a client component may not do. Pulling
 * the browser client out of there took the whole server module with it, and
 * the page would not build.
 *
 * It carries the anon key, so everything it does still goes through row-level
 * security. The one thing it is for is uploading a file straight to storage,
 * which cannot go through this app's own server: a serverless request body is
 * a few megabytes and an intro film is not.
 */
export function browserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error("The league database is not configured in this browser.");
  }

  return createBrowserClient(url, key);
}

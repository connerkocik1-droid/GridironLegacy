"use client";

import { useEffect } from "react";
import { refreshAll } from "@/lib/use-refresh";

/**
 * Installs the offline worker, and only in a build that has one.
 *
 * Not in development. A service worker in front of `next dev` serves yesterday's
 * chunks to today's page and turns every edit into a mystery — and the mobile
 * audit drives a dev server, so a worker there would be measuring a cache
 * rather than the app.
 *
 * The registration is deliberately late: after the first paint, off the
 * critical path, because nothing on the first load depends on it. What it is
 * for is the second load.
 */
export default function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // A worker that will not install costs nothing: every request then
        // goes to the network, which is what it did before this existed.
      });
    };

    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });

    // Coming back onto a network is the moment every board on screen is
    // showing something the worker handed back from its cache. Ask them all
    // again rather than leaving a stale number under a banner that has just
    // disappeared.
    const again = () => void refreshAll(0);
    window.addEventListener("online", again);

    return () => {
      window.removeEventListener("load", register);
      window.removeEventListener("online", again);
    };
  }, []);

  return null;
}

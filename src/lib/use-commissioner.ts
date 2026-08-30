"use client";

import { useEffect, useState } from "react";

/**
 * Who the viewer is, as far as the league office is concerned.
 *
 * - `checking`      — the answer has not come back, or the request failed.
 * - `commissioner`  — the manager who holds the office.
 * - `manager`       — signed in as somebody else, or not signed in at all.
 * - `no-league`     — the database is not configured, so there is no office
 *                     and nobody to hold it.
 *
 * A failed request stays `checking` rather than falling through to
 * `commissioner`: the gates built on this hide on anything but a clear yes.
 */
export type Office = "checking" | "commissioner" | "manager" | "no-league";

export function useOffice(): Office {
  const [office, setOffice] = useState<Office>("checking");

  useEffect(() => {
    const stop = new AbortController();

    fetch("/api/auth/me", { cache: "no-store", signal: stop.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return;
        if (data.configured === false) return setOffice("no-league");
        setOffice(data.manager?.is_commissioner ? "commissioner" : "manager");
      })
      .catch(() => {});

    return () => stop.abort();
  }, []);

  return office;
}

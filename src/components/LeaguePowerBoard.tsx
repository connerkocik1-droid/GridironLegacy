"use client";

import { useCallback, useEffect, useState } from "react";
import PowerRank from "./PowerRank";
import { useRefreshable } from "@/lib/use-refresh";
import type { Home } from "@/lib/home-types";

/**
 * The League Power sub-tab under Rankings.
 *
 * `PowerRank` used to be a card on the old Home dashboard; the three-tab
 * redesign gives the power rankings their own destination instead, since
 * Home is gone. The data is still read off `/api/home` — it is the one
 * endpoint that already computes `power` alongside the rest of what used
 * to share the page with it, and splitting that computation out into its
 * own route is a bigger change than this pass needs.
 */
export default function LeaguePowerBoard() {
  const [home, setHome] = useState<Home | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/home", { cache: "no-store" });
      if (res.status === 401) return setError("Sign in to see your league.");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        return setError(body.error ?? "Could not read the league.");
      }
      setHome(await res.json());
      setError(null);
    } catch {
      setError("Could not read the league.");
    }
  }, []);

  useRefreshable(load);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  return (
    <div style={{ padding: "18px 26px 40px", maxWidth: 640, margin: "0 auto" }}>
      <div style={{ fontSize: 10, letterSpacing: ".32em", color: "var(--text-dim)", marginBottom: 10 }}>
        WEEK {home?.week ?? ""}
      </div>
      {error ? (
        <div style={{ color: "var(--text-dim)", fontSize: 13 }}>{error}</div>
      ) : !home ? (
        <div style={{ color: "var(--text-dim)", fontSize: 13 }}>Loading…</div>
      ) : !home.played ? (
        <div style={{ color: "var(--text-dim)", fontSize: 13 }}>
          Power rankings start once a week has been settled.
        </div>
      ) : (
        <PowerRank power={home.power} />
      )}
    </div>
  );
}

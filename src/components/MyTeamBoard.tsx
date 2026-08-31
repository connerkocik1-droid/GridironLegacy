"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import LineupEditor from "./LineupEditor";

interface Feed {
  week: number;
  scores: Record<string, { points: number; statLine: string; updatedAt: string }>;
}

/**
 * Owns the live scores and hands them to the lineup editor, so the two are
 * never fetched twice or shown out of step with each other.
 */
export default function MyTeamBoard() {
  const [feed, setFeed] = useState<Feed | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/scores", { cache: "no-store" });
      if (!res.ok) {
        // The lineup editor reports the sign-in and configuration cases; this
        // only needs to avoid showing stale scores beside a fresh lineup.
        setFeed(null);
        return;
      }
      setFeed(await res.json());
      setError(null);
    } catch {
      setError("Live scores are unavailable right now.");
    }
  }, []);

  useEffect(() => {
    // Sets state only once the request resolves, not synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    const timer = setInterval(() => void load(), 60_000);
    return () => clearInterval(timer);
  }, [load]);

  const scores = useMemo(
    () =>
      new Map(
        Object.entries(feed?.scores ?? {}).map(([name, s]) => [
          name,
          { points: s.points, statLine: s.statLine },
        ]),
      ),
    [feed],
  );

  return (
    <>
      {error ? (
        <div style={{ padding: "8px 26px 0", fontSize: 12, color: "#e0b573" }}>{error}</div>
      ) : null}
      <LineupEditor scores={scores} />
    </>
  );
}

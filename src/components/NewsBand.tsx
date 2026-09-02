"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import NewsWire from "./NewsWire";
import type { Story } from "@/lib/news";

const card: React.CSSProperties = {
  border: "1px solid rgba(145,132,217,.22)",
  borderRadius: "var(--radius-lg)",
  background: "rgba(26,28,43,.55)",
  overflow: "hidden",
};

/**
 * The wire on the home page: everything, the same for everybody.
 *
 * It used to carry a second tab narrowed to this manager's roster and
 * watchlist. That has moved to My Team, where the rest of what belongs to one
 * franchise lives — this band is the league's news now, and only that, which
 * is also why it no longer has to know who is reading it.
 *
 * Only the first few; the whole wire is a page, and this is the part worth a
 * glance from the home page.
 */
export default function NewsBand({ limit = 4 }: { limit?: number }) {
  const [stories, setStories] = useState<Story[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      const wire = await fetch("/api/news").then((r) => (r.ok ? r.json() : { stories: [] }));
      setStories(wire.stories ?? []);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    // Sets state only once the request resolves, not synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  if (failed) {
    return (
      <div style={{ ...card, padding: "14px 18px", fontSize: 12.5, color: "#9397ab" }}>
        Could not reach the wire just now.
      </div>
    );
  }

  if (!stories) {
    return <div style={{ fontSize: 12, color: "#75798c" }}>Reading the wire…</div>;
  }

  return (
    <>
      <div style={card}>
        <NewsWire stories={stories.slice(0, limit)} />
      </div>

      <div style={{ marginTop: 10, fontSize: 11, display: "flex", gap: 14, flexWrap: "wrap" }}>
        <Link
          href="/news"
          style={{
            color: "#b5abfc",
            textDecoration: "none",
            display: "inline-flex",
            alignItems: "center",
            minHeight: 34,
          }}
        >
          The whole wire →
        </Link>
        <Link
          href="/news?view=players"
          style={{
            color: "#75798c",
            textDecoration: "none",
            display: "inline-flex",
            alignItems: "center",
            minHeight: 34,
          }}
        >
          Just your players →
        </Link>
      </div>
    </>
  );
}

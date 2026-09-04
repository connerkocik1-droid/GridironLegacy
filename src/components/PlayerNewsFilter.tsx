"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import NewsWire from "./NewsWire";
import type { Story } from "@/lib/news";

/**
 * The wire, either whole or filtered to the signed-in manager's players.
 *
 * Player news used to be a page of its own. It is the same wire against a
 * different filter, so it is a view of this one instead, and which view is
 * showing lives in the URL — /news?view=players is still a link somebody can
 * send.
 *
 * The stories arrive already fetched from the server; only the roster is
 * per-manager, so only that is fetched here. `children` is the unfiltered wire,
 * rendered on the server, which is what a signed-out visitor sees.
 */
export default function PlayerNewsFilter({
  stories,
  children,
}: {
  stories: Story[];
  children: React.ReactNode;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const mineOnly = params.get("view") === "players";

  const [roster, setRoster] = useState<Set<string> | null>(null);
  const [signedOut, setSignedOut] = useState(false);

  const load = useCallback(async () => {
    try {
      // The roster and the watchlist together. "Your players" means the ones
      // you own and the ones you are deciding about — the player you do not
      // hold yet is exactly the one whose hamstring you want to hear about
      // before you spend a claim on him.
      const [res, watching] = await Promise.all([
        fetch("/api/lineup", { cache: "no-store" }),
        fetch("/api/watchlist", { cache: "no-store" })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
      ]);

      if (!res.ok) return setSignedOut(true);
      const body = await res.json();

      setRoster(
        new Set([
          ...(body.assignments ?? []).map((a: { playerName: string }) => a.playerName),
          ...((watching?.players ?? []) as string[]),
        ]),
      );
    } catch {
      setSignedOut(true);
    }
  }, []);

  useEffect(() => {
    // Sets state only once the request resolves, not synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const card: React.CSSProperties = {
    border: "1px solid rgba(145,132,217,.22)",
    borderRadius: "var(--radius-lg)",
    background: "rgba(26,28,43,.55)",
    overflow: "hidden",
  };

  // Signed out, or the roster has not arrived: show the wire the server built.
  if (signedOut || !roster) {
    return (
      <>
        {signedOut ? (
          <p style={{ fontSize: 12, color: "#9397ab", margin: "0 0 12px" }}>
            Sign in to see which of these are about your players.
          </p>
        ) : null}
        <div style={card}>{children}</div>
      </>
    );
  }

  const mine = stories.filter((s) => s.players.some((p) => roster.has(p)));
  const shown = mineOnly ? mine : stories;

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "0 0 12px", flexWrap: "wrap" }}>
        <p style={{ fontSize: 12, color: "#9397ab", margin: 0 }}>
          {mine.length} of {stories.length} stories mention your players or the ones
          you are watching.
        </p>
        <div style={{ display: "flex", gap: 4 }}>
          {[
            { label: "Everything", on: false },
            { label: "Mine & watched", on: true },
          ].map((opt) => (
            <button
              key={opt.label}
              onClick={() =>
                router.replace(opt.on ? "/news?view=players" : "/news", { scroll: false })
              }
              aria-current={mineOnly === opt.on ? "page" : undefined}
              style={{
                padding: "5px 10px",
                fontSize: 10,
                letterSpacing: ".1em",
                textTransform: "uppercase",
                border: `1px solid ${mineOnly === opt.on ? "rgba(181,171,252,.6)" : "rgba(145,132,217,.24)"}`,
                background: mineOnly === opt.on ? "rgba(145,132,217,.26)" : "transparent",
                color: mineOnly === opt.on ? "#e9e9ed" : "#9397ab",
                borderRadius: "var(--radius-sm)",
                fontFamily: "inherit",
                cursor: "pointer",
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div style={card}>
        <NewsWire
          stories={shown}
          highlight={roster}
          emptyMessage={
            mineOnly
              ? "Nothing on the wire about your players right now. Switch to Everything for the full feed."
              : undefined
          }
        />
      </div>
    </>
  );
}

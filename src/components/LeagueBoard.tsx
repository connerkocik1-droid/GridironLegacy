"use client";

import { useCallback, useEffect, useState } from "react";
import { headshot, logo } from "@/data/league-data";
import { player } from "@/lib/roster";

const BLANK =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

interface Franchise {
  id: string;
  slot: string;
  name: string;
  franchise: string;
  claimed: boolean;
  isCommissioner: boolean;
  pointsFor: number;
  roster: { name: string; slot: string; acquired: string }[];
}

interface Feed {
  meId: string;
  league: { name: string; season: number } | null;
  weeksScored: number;
  franchises: Franchise[];
}

export default function LeagueBoard() {
  const [feed, setFeed] = useState<Feed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/league", { cache: "no-store" });
      if (res.status === 401) return setError("Sign in to see the league.");
      if (res.status === 503) {
        const body = await res.json().catch(() => ({}));
        return setError(body.error ?? "The league database is not configured yet.");
      }
      if (!res.ok) throw new Error(String(res.status));
      setFeed(await res.json());
      setError(null);
    } catch {
      setError("Could not load the league.");
    }
  }, []);

  useEffect(() => {
    // Sets state only once the request resolves, not synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  if (error && !feed) {
    return <div style={{ padding: "24px 26px", color: "#e0b573" }}>{error}</div>;
  }
  if (!feed) {
    return <div style={{ padding: "24px 26px", color: "#75798c" }}>Reading the league…</div>;
  }

  const ranked = [...feed.franchises].sort((a, b) => b.pointsFor - a.pointsFor);

  return (
    <div style={{ padding: "24px 26px 40px" }}>
      <div style={{ fontSize: 9, letterSpacing: ".32em", color: "#75798c" }}>
        {feed.league?.season ?? ""} SEASON
      </div>
      <h1
        style={{
          fontFamily: "var(--font-heading)",
          fontSize: 40,
          letterSpacing: "-.035em",
          margin: "8px 0 6px",
          fontWeight: 500,
        }}
      >
        {feed.league?.name ?? "League"}
      </h1>
      <p style={{ fontSize: 12, color: "#9397ab", margin: "0 0 20px", maxWidth: "70ch", lineHeight: 1.6 }}>
        {feed.weeksScored > 0
          ? `Ordered by points scored across ${feed.weeksScored} scored ${feed.weeksScored === 1 ? "week" : "weeks"}. Win–loss records arrive with the season schedule.`
          : "Nothing has been scored yet. Once games are played, franchises are ordered by points."}
      </p>

      <div
        style={{
          border: "1px solid rgba(145,132,217,.22)",
          borderRadius: "var(--radius-lg)",
          background: "rgba(26,28,43,.55)",
          overflow: "hidden",
        }}
      >
        {ranked.map((f, i) => {
          const isOpen = open === f.id;
          const starters = f.roster.filter((r) => r.slot !== "BENCH" && r.slot !== "IR");

          return (
            <div key={f.id}>
              <div
                onClick={() => setOpen(isOpen ? null : f.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setOpen(isOpen ? null : f.id);
                  }
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "13px 18px",
                  borderTop: i === 0 ? undefined : "1px solid rgba(145,132,217,.12)",
                  cursor: "pointer",
                  background:
                    f.id === feed.meId ? "rgba(66,58,106,.26)" : isOpen ? "rgba(35,37,50,.5)" : "transparent",
                  boxShadow: f.id === feed.meId ? "inset 2px 0 0 #b5abfc" : undefined,
                }}
              >
                <span
                  style={{
                    fontFamily: "var(--font-heading)",
                    fontSize: 15,
                    color: "#75798c",
                    width: 22,
                    flex: "0 0 auto",
                  }}
                >
                  {i + 1}
                </span>

                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ fontFamily: "var(--font-heading)", fontSize: 16 }}>
                      {f.franchise}
                    </span>
                    {f.isCommissioner ? (
                      <span style={{ fontSize: 8, letterSpacing: ".14em", color: "#b5abfc" }}>
                        COMMISSIONER
                      </span>
                    ) : null}
                    {!f.claimed ? (
                      <span
                        style={{
                          fontSize: 8,
                          letterSpacing: ".14em",
                          padding: "2px 5px",
                          borderRadius: 2,
                          border: "1px solid rgba(145,132,217,.35)",
                          color: "#9397ab",
                        }}
                      >
                        OPEN
                      </span>
                    ) : null}
                  </div>
                  <div style={{ fontSize: 11, color: "#75798c", marginTop: 3 }}>
                    {f.claimed ? f.name : "Unclaimed"} · {f.roster.length} players ·{" "}
                    {starters.length} starting
                  </div>
                </div>

                <div style={{ textAlign: "right", flex: "0 0 auto" }}>
                  <div style={{ fontFamily: "var(--font-heading)", fontSize: 18, color: "#d2cefd" }}>
                    {f.pointsFor.toFixed(1)}
                  </div>
                  <div style={{ fontSize: 8, letterSpacing: ".16em", color: "#75798c" }}>
                    POINTS FOR
                  </div>
                </div>
              </div>

              {isOpen ? (
                <div style={{ background: "rgba(20,22,35,.55)", padding: "4px 18px 12px 52px" }}>
                  {f.roster.length === 0 ? (
                    <div style={{ fontSize: 12, color: "#75798c", padding: "8px 0" }}>
                      No players yet.
                    </div>
                  ) : null}
                  {f.roster.map((r) => {
                    const p = player(r.name);
                    const starting = r.slot !== "BENCH" && r.slot !== "IR";
                    return (
                      <div
                        key={r.name}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 9,
                          padding: "6px 0",
                          borderTop: "1px solid rgba(145,132,217,.08)",
                        }}
                      >
                        <span
                          style={{
                            fontSize: 9,
                            letterSpacing: ".12em",
                            width: 34,
                            flex: "0 0 auto",
                            color: starting ? "#b5abfc" : "#5a5d6e",
                          }}
                        >
                          {r.slot === "D/ST" ? "DST" : r.slot}
                        </span>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={headshot(r.name) || BLANK}
                          alt=""
                          width={22}
                          height={22}
                          style={{
                            borderRadius: "50%",
                            objectFit: "contain",
                            border: "1px solid rgba(145,132,217,.22)",
                            background: "rgba(35,37,50,.7)",
                            flex: "0 0 auto",
                          }}
                        />
                        <span
                          style={{
                            fontSize: 13,
                            color: starting ? "#e9e9ed" : "#9397ab",
                            minWidth: 0,
                            flex: 1,
                          }}
                        >
                          {r.name}
                        </span>
                        {p?.t ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={logo(p.t)}
                            alt=""
                            width={13}
                            height={13}
                            style={{ objectFit: "contain", opacity: 0.75, flex: "0 0 auto" }}
                          />
                        ) : null}
                        <span
                          style={{
                            fontSize: 9,
                            letterSpacing: ".1em",
                            color: "#5a5d6e",
                            width: 44,
                            textAlign: "right",
                            flex: "0 0 auto",
                          }}
                        >
                          {r.acquired.toUpperCase()}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

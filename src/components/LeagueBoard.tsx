"use client";

import { useCallback, useEffect, useState } from "react";
import { headshot, logo } from "@/data/league-data";
import PlayerName from "./PlayerName";
import { player } from "@/lib/roster";
import LeagueOverview from "./LeagueOverview";
import type { Home } from "@/lib/home-types";

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
  record: { wins: number; losses: number; ties: number; pointsFor: number; pointsAgainst: number } | null;
  roster: { name: string; slot: string; acquired: string }[];
}

interface Feed {
  meId: string;
  league: { name: string; season: number } | null;
  weeksScored: number;
  played: boolean;
  franchises: Franchise[];
}

export default function LeagueBoard() {
  const [feed, setFeed] = useState<Feed | null>(null);
  const [home, setHome] = useState<Home | null>(null);
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

  useEffect(() => {
    // The leaders and the power rankings, which moved here off the home page.
    // Fetched separately because the franchise list below does not need it and
    // should not wait for it — if this never arrives the page is still a page.
    void fetch("/api/home", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then(setHome)
      .catch(() => {});
  }, []);

  if (error && !feed) {
    return <div style={{ padding: "24px 26px", color: "#e0b573" }}>{error}</div>;
  }
  if (!feed) {
    return <div style={{ padding: "24px 26px", color: "#75798c" }}>Reading the league…</div>;
  }

  // Once weeks have been graded the table is the standings: wins first, then
  // points as the tiebreak. Before that there is nothing to stand on but
  // production, and the note below says as much.
  const ranked = [...feed.franchises].sort((a, b) => {
    if (feed.played) {
      const w = (b.record?.wins ?? 0) - (a.record?.wins ?? 0);
      if (w) return w;
    }
    return b.pointsFor - a.pointsFor;
  });

  return (
    <div style={{ padding: "24px 26px 40px" }}>
      <div style={{ fontSize: 10, letterSpacing: ".32em", color: "#75798c" }}>
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
        {feed.played
          ? "Standings by record, with points as the tiebreak. A week counts once its games are over."
          : feed.weeksScored > 0
            ? `Ordered by points across ${feed.weeksScored} scored ${feed.weeksScored === 1 ? "week" : "weeks"}. No week has finished yet, so there are no records to stand on.`
            : "Nothing has been played yet. Once the schedule is built and games are graded, this becomes the standings."}
      </p>

      {/* Who is scoring and who is any good, above the franchise-by-franchise
          list — it is the summary the list below is the detail of. */}
      {home ? (
        <div style={{ marginBottom: 26 }}>
          <div
            style={{
              fontSize: 10,
              letterSpacing: ".28em",
              color: "#75798c",
              marginBottom: 12,
            }}
          >
            WHERE YOU STAND
            {home.played ? "" : " · NOTHING GRADED YET, RANKED ON POINTS ALONE"}
          </div>
          <LeagueOverview home={home} />
        </div>
      ) : null}

      <div style={{ fontSize: 10, letterSpacing: ".28em", color: "#75798c", marginBottom: 12 }}>
        EVERY FRANCHISE
      </div>

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
          // Nobody is benched in a best-ball league, so the only split worth
          // making is who is available at all: a man on injured reserve is not.
          const stashed = f.roster.filter((r) => r.slot === "IR").length;

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
                className="gl-league-row"
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
                      <span style={{ fontSize: 10, letterSpacing: ".14em", color: "#b5abfc" }}>
                        COMMISSIONER
                      </span>
                    ) : null}
                    {!f.claimed ? (
                      <span
                        style={{
                          fontSize: 10,
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
                    {f.claimed ? f.name : "Unclaimed"} · {f.roster.length} players
                    {stashed ? ` · ${stashed} on IR` : ""}
                  </div>
                </div>

                {feed.played ? (
                  <div style={{ textAlign: "right", flex: "0 0 auto", width: 66 }}>
                    <div style={{ fontFamily: "var(--font-heading)", fontSize: 18 }}>
                      {f.record?.wins ?? 0}–{f.record?.losses ?? 0}
                      {f.record?.ties ? `–${f.record.ties}` : ""}
                    </div>
                    <div style={{ fontSize: 10, letterSpacing: ".16em", color: "#75798c" }}>
                      RECORD
                    </div>
                  </div>
                ) : null}

                <div style={{ textAlign: "right", flex: "0 0 auto", width: 74 }}>
                  <div style={{ fontFamily: "var(--font-heading)", fontSize: 18, color: "#d2cefd" }}>
                    {(feed.played ? (f.record?.pointsFor ?? 0) : f.pointsFor).toFixed(1)}
                  </div>
                  <div style={{ fontSize: 10, letterSpacing: ".16em", color: "#75798c" }}>
                    {feed.played ? "PF" : "POINTS FOR"}
                  </div>
                </div>

                {feed.played ? (
                  <div style={{ textAlign: "right", flex: "0 0 auto", width: 66 }}>
                    <div style={{ fontFamily: "var(--font-heading)", fontSize: 18, color: "#9397ab" }}>
                      {(f.record?.pointsAgainst ?? 0).toFixed(1)}
                    </div>
                    <div style={{ fontSize: 10, letterSpacing: ".16em", color: "#75798c" }}>PA</div>
                  </div>
                ) : null}
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
                    const available = r.slot !== "IR";
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
                            fontSize: 10,
                            letterSpacing: ".12em",
                            width: 34,
                            flex: "0 0 auto",
                            color: available ? "#b5abfc" : "#5a5d6e",
                          }}
                        >
                          {available
                            ? p?.p === "D/ST"
                              ? "DST"
                              : (p?.p ?? "—")
                            : "IR"}
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
                        <span style={{ minWidth: 0, flex: 1 }}>
                          <PlayerName
                            name={r.name}
                            style={{ fontSize: 13, color: available ? "#e9e9ed" : "#9397ab" }}
                          />
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
                            fontSize: 10,
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

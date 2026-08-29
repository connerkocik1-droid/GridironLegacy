"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { headshot, logo, statLine } from "@/data/league-data";
import { bestLineup, type Score } from "@/lib/matchup";
import { flagColor, flagsFor, player, proj } from "@/lib/roster";

const BLANK =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

interface Feed {
  week: number;
  me: { id: string; slot: string; franchise: string };
  roster: { player_name: string; lineup_slot: string }[];
  scores: Record<string, { points: number; statLine: string; updatedAt: string }>;
}

const card: React.CSSProperties = {
  border: "1px solid rgba(145,132,217,.22)",
  borderRadius: "var(--radius-lg)",
  background: "rgba(26,28,43,.55)",
  overflow: "hidden",
};

function Row({
  slot,
  name,
  score,
  starter,
}: {
  slot: string;
  name: string;
  score: Score | undefined;
  starter: boolean;
}) {
  const p = player(name);
  const flags = flagsFor(name);
  const projection = proj(name);
  const live = score != null;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: starter ? "12px 18px" : "11px 18px",
        borderTop: "1px solid rgba(145,132,217,.12)",
      }}
    >
      <span
        style={{
          fontFamily: "var(--font-heading)",
          fontSize: 10,
          letterSpacing: ".14em",
          width: 38,
          flex: "0 0 auto",
          color: starter ? "#b5abfc" : "#75798c",
        }}
      >
        {slot === "D/ST" ? "DST" : slot}
      </span>

      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={headshot(name) || BLANK}
        alt=""
        width={starter ? 34 : 30}
        height={starter ? 34 : 30}
        style={{
          borderRadius: "50%",
          objectFit: "contain",
          border: "1px solid rgba(145,132,217,.3)",
          background: "rgba(35,37,50,.7)",
          flex: "0 0 auto",
        }}
      />

      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <span
            style={{
              fontFamily: "var(--font-heading)",
              fontSize: starter ? 15 : 14,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              minWidth: 0,
            }}
          >
            {name}
          </span>
          {p?.t ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logo(p.t)}
              alt=""
              width={15}
              height={15}
              style={{ objectFit: "contain", opacity: 0.85, flex: "0 0 auto" }}
            />
          ) : null}
          <span
            style={{
              fontSize: 9,
              letterSpacing: ".12em",
              color: "#75798c",
              whiteSpace: "nowrap",
              flex: "0 0 auto",
            }}
          >
            {p ? `${p.p}${p.t ? ` · ${p.t}` : ""}` : ""}
          </span>
          {flags.map((f) => (
            <span
              key={f.label}
              style={{
                fontSize: 8,
                letterSpacing: ".12em",
                padding: "2px 5px",
                borderRadius: 2,
                flex: "0 0 auto",
                border: `1px solid ${flagColor(f.kind)}66`,
                color: flagColor(f.kind),
              }}
            >
              {f.label}
            </span>
          ))}
        </div>
        <div
          style={{
            fontSize: 11,
            color: live ? "#9397ab" : "#75798c",
            marginTop: 3,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {/* Once a player has played, his real line replaces last season's. */}
          {live ? score.statLine : p ? statLine(p) : ""}
        </div>
      </div>

      <div style={{ textAlign: "right", flex: "0 0 auto" }}>
        <div
          style={{
            fontFamily: "var(--font-heading)",
            fontSize: starter ? 17 : 15,
            color: live ? "#d2cefd" : "#b2b6ca",
          }}
        >
          {(live ? score.points : projection).toFixed(1)}
        </div>
        <div style={{ fontSize: 8, letterSpacing: ".16em", color: "#75798c" }}>
          {live ? "LIVE" : "PROJ"}
        </div>
      </div>
    </div>
  );
}

export default function MyTeamBoard() {
  const [feed, setFeed] = useState<Feed | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/scores", { cache: "no-store" });
      if (res.status === 401) return setError("Sign in to see your team.");
      if (res.status === 503) {
        const body = await res.json().catch(() => ({}));
        return setError(body.error ?? "The league database is not configured yet.");
      }
      if (!res.ok) throw new Error(String(res.status));
      setFeed(await res.json());
      setError(null);
    } catch {
      setError("Could not load your roster.");
    }
  }, []);

  useEffect(() => {
    // Sets state only once the request resolves, not synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    const timer = setInterval(() => void load(), 60_000);
    return () => clearInterval(timer);
  }, [load]);

  const view = useMemo(() => {
    if (!feed) return null;

    const scores = new Map<string, Score>(
      Object.entries(feed.scores).map(([name, s]) => [
        name,
        { points: s.points, statLine: s.statLine },
      ]),
    );

    const names = feed.roster.map((r) => r.player_name);
    const lineup = bestLineup(names, null, scores);
    const starting = new Set(lineup.map((l) => l.entry?.name).filter(Boolean) as string[]);
    const bench = names.filter((n) => !starting.has(n));

    const total = lineup.reduce(
      (sum, l) => sum + (l.entry ? (scores.get(l.entry.name)?.points ?? proj(l.entry.name)) : 0),
      0,
    );

    const played = names.filter((n) => scores.has(n)).length;

    return { scores, lineup, bench, total, played, names };
  }, [feed]);

  if (error && !feed) {
    return <div style={{ padding: "24px 26px", color: "#e0b573" }}>{error}</div>;
  }
  if (!feed || !view) {
    return <div style={{ padding: "24px 26px", color: "#75798c" }}>Reading your roster…</div>;
  }

  return (
    <>
      <div
        style={{
          padding: "24px 26px 12px",
          display: "flex",
          alignItems: "flex-end",
          gap: 26,
          flexWrap: "wrap",
        }}
      >
        <div>
          <div style={{ fontSize: 9, letterSpacing: ".32em", color: "#75798c" }}>
            DYNASTY · 12 TEAM · SUPERFLEX
          </div>
          <div
            style={{
              fontFamily: "var(--font-heading)",
              fontSize: 44,
              lineHeight: 1.04,
              letterSpacing: "-.035em",
              margin: "8px 0 0",
            }}
          >
            {feed.me.franchise}
          </div>
        </div>
        <div style={{ display: "flex", gap: 22, marginLeft: "auto", flexWrap: "wrap" }}>
          <div>
            <div style={{ fontFamily: "var(--font-heading)", fontSize: 26, color: "#d2cefd" }}>
              {view.total.toFixed(1)}
            </div>
            <div style={{ fontSize: 9, letterSpacing: ".2em", color: "#75798c" }}>
              {view.played ? "LIVE TOTAL" : "PROJECTED"}
            </div>
          </div>
          <div>
            <div style={{ fontFamily: "var(--font-heading)", fontSize: 26 }}>
              {view.played} / {view.names.length}
            </div>
            <div style={{ fontSize: 9, letterSpacing: ".2em", color: "#75798c" }}>PLAYED</div>
          </div>
        </div>
      </div>

      {error ? (
        <div style={{ padding: "0 26px 8px", fontSize: 12, color: "#e0b573" }}>{error}</div>
      ) : null}

      <div style={{ padding: "12px 26px 40px" }}>
        <div style={card}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "14px 18px",
            }}
          >
            <h6 style={{ margin: 0, color: "#d2cefd" }}>Starting lineup</h6>
            <span style={{ fontSize: 10, letterSpacing: ".16em", color: "#75798c" }}>
              WEEK {feed.week} · {view.lineup.length} SLOTS
            </span>
          </div>

          {view.lineup.map((row, i) => (
            <Row
              key={`${row.slot}-${i}`}
              slot={row.slot}
              name={row.entry?.name ?? "—"}
              score={row.entry ? view.scores.get(row.entry.name) : undefined}
              starter
            />
          ))}

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "14px 18px",
              borderTop: "1px solid rgba(145,132,217,.18)",
              background: "rgba(20,22,35,.5)",
            }}
          >
            <h6 style={{ margin: 0, color: "#9397ab" }}>Bench</h6>
            <span style={{ fontSize: 10, letterSpacing: ".16em", color: "#75798c" }}>
              {view.bench.length} PLAYERS
            </span>
          </div>

          {view.bench.map((name) => {
            const p = player(name);
            return (
              <Row
                key={name}
                slot={p?.p === "D/ST" ? "DST" : (p?.p ?? "—")}
                name={name}
                score={view.scores.get(name)}
                starter={false}
              />
            );
          })}
        </div>
      </div>
    </>
  );
}

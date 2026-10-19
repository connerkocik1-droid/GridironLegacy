"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import type { MatchupRow, SideEntry } from "@/lib/matchup";
import { recordText } from "@/lib/record";
import { useRefreshable } from "@/lib/use-refresh";
import { openPlayer } from "@/lib/player-sheet";
import { gameFor, gameLabel, useNflGames } from "@/lib/use-nfl-games";
import { fanfare } from "@/lib/retro";
import { biggestJump, fanfareText, type Reading } from "@/lib/retro-cues";
import DuesNotice from "./DuesNotice";
import { AppView, GroupSkeleton, Note, bigItalic, hairline, heroPanel, ink, listPanel, tint } from "./RowList";

interface Side {
  id: string;
  name?: string;
  franchise: string;
  total: number;
  projected?: number;
  record?: { w: number; l: number; t: number };
}

interface Board {
  week: number;
  home: Side;
  away: Side;
  rows: MatchupRow[];
  live: boolean;
  started: boolean;
  final: boolean;
  mine?: boolean;
  winProbability?: number | null;
}

/** How long a scoring play's "+3.1" chip and row glow stay. */
const FLASH_MS = 2_400;

/**
 * The League → Matchup: your game, head to head. A lit hero with both scores,
 * win probability and projected finals, then the best-ball lineups slot by
 * slot with a two-sided bar per slot. When a player scores between two
 * readings his row glows and a "+3.1" chip flashes beside his points. From
 * the Matchup view in prototype/Pylon App.dc.html.
 *
 * ?home=, ?week= and ?opponent= still name any other pairing, as the old board
 * did — Around League opens other games here.
 */
export default function MatchupView() {
  return (
    <Suspense
      fallback={
        <AppView>
          <GroupSkeleton rows={10} label={false} />
        </AppView>
      }
    >
      <View />
    </Suspense>
  );
}

function View() {
  const params = useSearchParams();
  const asHome = params.get("home") ?? "";
  const asWeek = params.get("week") ?? "";
  const opponent = params.get("opponent") ?? "";
  const { games } = useNflGames();

  const [board, setBoard] = useState<Board | null>(null);
  const [bye, setBye] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<Record<string, { d: number; until: number }>>({});
  const last = useRef<{ key: string; pts: Map<string, number> } | null>(null);
  const lastMine = useRef<{ key: string; readings: Reading[] } | null>(null);

  // Scoring plays between two readings: every player on either side whose
  // points went up gets a chip, and — for the reader's own players in
  // sixteen-bit mode — a big enough one gets the touchdown fanfare.
  const notice = useCallback((next: Board) => {
    const key = `${next.week}:${next.home.id}:${next.away.id}`;
    const pts = new Map<string, number>();
    for (const r of next.rows) for (const e of [r.home, r.away]) if (e) pts.set(e.name, e.points);
    const before = last.current?.key === key ? last.current.pts : null;
    last.current = { key, pts };
    if (before && next.live) {
      const now = Date.now();
      const gained: Record<string, { d: number; until: number }> = {};
      for (const [name, p] of pts) {
        const was = before.get(name);
        if (was != null && p - was > 0.05) gained[name] = { d: p - was, until: now + FLASH_MS };
      }
      if (Object.keys(gained).length) setFlash((f) => ({ ...f, ...gained }));
    }

    if (next.mine) {
      const readings: Reading[] = next.rows.flatMap((row) =>
        row.home ? [{ name: row.home.name, points: row.home.points, live: row.home.live }] : [],
      );
      const prior = lastMine.current?.key === key ? lastMine.current.readings : null;
      lastMine.current = { key, readings };
      const jump = next.live ? biggestJump(prior, readings) : null;
      if (jump) fanfare(fanfareText(jump));
    }
  }, []);

  const load = useCallback(async () => {
    try {
      const q = new URLSearchParams();
      if (asHome) q.set("home", asHome);
      if (asWeek) q.set("week", asWeek);
      if (opponent) q.set("opponent", opponent);
      const res = await fetch(`/api/matchup${q.size ? `?${q}` : ""}`, { cache: "no-store" });
      if (res.status === 401) return setError("Sign in to see your matchup.");
      if (res.status === 503) {
        const body = await res.json().catch(() => ({}));
        return setError(body.error ?? "The league database is not configured yet.");
      }
      if (!res.ok) throw new Error(String(res.status));
      const body = await res.json();
      // A bye answers 200 without two sides, because there are not two sides.
      if (!body?.home || !body?.away) {
        setBye(body?.week ?? 0);
        setBoard(null);
        setError(null);
        return;
      }
      setBye(null);
      notice(body);
      setBoard(body);
      setError(null);
    } catch {
      setError("Could not load this week's matchup.");
    }
  }, [asHome, asWeek, opponent, notice]);

  useRefreshable(load);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    const t = setInterval(() => void load(), 60_000);
    return () => clearInterval(t);
  }, [load]);

  // Let expired chips go.
  useEffect(() => {
    const live = Object.values(flash).filter((f) => f.until > Date.now());
    if (!live.length) return;
    const next = Math.min(...live.map((f) => f.until)) - Date.now() + 30;
    const t = setTimeout(() => {
      const now = Date.now();
      setFlash((f) => Object.fromEntries(Object.entries(f).filter(([, v]) => v.until > now)));
    }, next);
    return () => clearTimeout(t);
  }, [flash]);

  if (error && !board) {
    return (
      <AppView>
        <Note tag="MATCHUP" tone="warn">{error}</Note>
      </AppView>
    );
  }
  if (bye != null) {
    return (
      <AppView>
        <DuesNotice />
        <Note tag={`WEEK ${bye}`}>
          A bye this week — no fixture, so no board.{" "}
          <Link href="/the-league" style={{ color: "var(--ap-a300)" }}>
            See the rest of the league →
          </Link>
        </Note>
      </AppView>
    );
  }
  if (!board) {
    return (
      <AppView>
        <GroupSkeleton rows={2} label={false} />
        <GroupSkeleton rows={10} label={false} />
      </AppView>
    );
  }

  const { home, away } = board;
  const homeLead = home.total >= away.total;
  const prob = board.winProbability != null ? Math.round(board.winProbability * 100) : null;
  const sub = (s: Side) => [s.name?.split(" ")[0], s.record ? recordText(s.record.w, s.record.l, s.record.t) : null].filter(Boolean).join(" · ");
  const probLabel = board.final
    ? board.mine
      ? home.total > away.total
        ? "FINAL · WON"
        : home.total < away.total
          ? "FINAL · LOST"
          : "FINAL · TIED"
      : "FINAL"
    : prob != null
      ? `WIN PROB ${prob}%`
      : board.started
        ? "IN PROGRESS"
        : `WEEK ${board.week}`;
  const projLabel =
    home.projected != null && away.projected != null
      ? `PROJ ${home.projected.toFixed(1)} – ${away.projected.toFixed(1)}`
      : "";

  return (
    <AppView>
      <DuesNotice />
      {!board.mine ? (
        <Note tag={`WEEK ${board.week}`}>
          {home.franchise} against {away.franchise}.{" "}
          <Link href="/lineup" style={{ color: "var(--ap-a300)" }}>
            Back to your game →
          </Link>
        </Note>
      ) : null}

      <div style={{ ...heroPanel, marginBottom: 8 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "end", gap: 8, padding: "10px 12px" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{home.franchise}</div>
            <div style={{ fontSize: 10, color: "var(--ap-n500)", marginTop: 2 }}>{sub(home)}</div>
            <div style={{ ...bigItalic(28, homeLead), marginTop: 4 }}>{home.total.toFixed(1)}</div>
          </div>
          <span style={{ fontSize: 10, letterSpacing: ".16em", color: "var(--ap-n600)", paddingBottom: 10 }}>VS</span>
          <div style={{ minWidth: 0, textAlign: "right" }}>
            <div style={{ fontSize: 12, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{away.franchise}</div>
            <div style={{ fontSize: 10, color: "var(--ap-n500)", marginTop: 2 }}>{sub(away)}</div>
            <div style={{ ...bigItalic(28, !homeLead), marginTop: 4 }}>{away.total.toFixed(1)}</div>
          </div>
        </div>
        <div style={{ padding: "0 12px 10px" }}>
          <div style={{ height: 4, borderRadius: 2, background: ink(10), overflow: "hidden" }}>
            <div
              style={{
                height: "100%",
                width: `${prob ?? (home.total + away.total ? (home.total / (home.total + away.total)) * 100 : 50)}%`,
                background: "linear-gradient(90deg,var(--ap-a600),var(--ap-a200))",
                boxShadow: "0 0 10px var(--ap-accent)",
                transition: "width .8s ease",
              }}
            />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 10, letterSpacing: ".1em", color: "var(--ap-n400)" }}>
            <span>{probLabel}</span>
            <span>{projLabel}</span>
          </div>
        </div>
      </div>

      <div style={listPanel}>
        {board.rows.map((r, i) => (
          <SlotRow key={`${r.slot}:${i}`} row={r} first={i === 0} flash={flash} games={games} />
        ))}
      </div>
    </AppView>
  );
}

function SlotRow({
  row,
  first,
  flash,
  games,
}: {
  row: MatchupRow;
  first: boolean;
  flash: Record<string, { d: number; until: number }>;
  games: ReturnType<typeof useNflGames>["games"];
}) {
  const a = row.home?.points ?? 0;
  const b = row.away?.points ?? 0;
  const mx = Math.max(a, b, 1);
  // Expired chips are pruned by the board's timer, so presence is enough.
  const fm = row.home ? (flash[row.home.name] ?? null) : null;
  const ft = row.away ? (flash[row.away.name] ?? null) : null;
  const label = (e: SideEntry | null) => {
    if (!e) return "";
    const g = gameFor(games, e.team);
    if (g) return gameLabel(g);
    if (e.game) return e.game.state === "post" ? "FINAL" : e.game.state === "in" ? "LIVE" : `PROJ ${e.projected.toFixed(1)}`;
    return e.team ? "BYE" : "";
  };
  const started = (e: SideEntry | null) => !!e && (e.game ? e.game.state !== "pre" : e.live || e.points !== 0);
  const pts = (e: SideEntry | null, v: number) => (started(e) ? v.toFixed(1) : "–");
  const ptsStyle = (lead: boolean, right?: boolean): React.CSSProperties => ({
    flex: "0 0 auto",
    width: 38,
    textAlign: right ? "left" : "right",
    fontSize: 13,
    fontWeight: 500,
    fontVariantNumeric: "tabular-nums",
    color: lead ? "var(--ap-a200)" : "var(--ap-n400)",
  });
  const chip = (f: { d: number } | null, mine: boolean) =>
    f ? (
      <span
        key={`${f.d}`}
        style={{
          flex: "0 0 auto",
          fontSize: 9,
          fontWeight: 600,
          padding: "1px 4px",
          borderRadius: 2,
          animation: "ap-flash 2.4s ease both",
          ...(mine
            ? { color: "var(--ap-a100)", background: tint(38), boxShadow: "0 0 10px var(--ap-accent)" }
            : { color: "var(--ap-n200)", background: ink(14) }),
        }}
      >
        +{f.d.toFixed(1)}
      </span>
    ) : null;
  const name = (e: SideEntry | null, right?: boolean) => (
    <button
      type="button"
      onClick={() => e && openPlayer(e.name)}
      disabled={!e}
      style={{
        minWidth: 0,
        flex: 1,
        textAlign: right ? "right" : "left",
        cursor: e ? "pointer" : "default",
        border: 0,
        background: "transparent",
        padding: 0,
        font: "inherit",
        color: "inherit",
      }}
    >
      <div style={{ fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: right ? "var(--ap-n300)" : undefined }}>
        {e ? e.name : "—"}
      </div>
      <div style={{ fontSize: 9, color: "var(--ap-n500)", marginTop: 2 }}>{label(e)}</div>
    </button>
  );

  return (
    <div
      style={{
        padding: "7px 10px 6px",
        transition: "background-color .6s ease",
        ...(first ? {} : hairline),
        ...(fm ? { backgroundColor: tint(14) } : {}),
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {name(row.home)}
        {chip(fm, true)}
        <span style={ptsStyle(a >= b && started(row.home))}>{pts(row.home, a)}</span>
        <span style={{ fontSize: 9, letterSpacing: ".12em", color: "var(--ap-n500)", width: 34, textAlign: "center", flex: "0 0 auto" }}>
          {row.slot}
        </span>
        <span style={ptsStyle(b > a && started(row.away), true)}>{pts(row.away, b)}</span>
        {chip(ft, false)}
        {name(row.away, true)}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 3, marginTop: 5 }}>
        <div style={{ display: "flex", justifyContent: "flex-end", height: 3, borderRadius: "2px 0 0 2px", overflow: "hidden", background: ink(6) }}>
          <div
            style={{
              height: "100%",
              transition: "width .6s ease",
              width: `${Math.round((Math.max(0, a) / mx) * 100)}%`,
              background: a >= b ? "linear-gradient(270deg,var(--ap-a200),var(--ap-a600))" : "var(--ap-n600)",
              boxShadow: a >= b ? "0 0 6px var(--ap-accent)" : undefined,
            }}
          />
        </div>
        <div style={{ display: "flex", height: 3, borderRadius: "0 2px 2px 0", overflow: "hidden", background: ink(6) }}>
          <div
            style={{
              height: "100%",
              transition: "width .6s ease",
              width: `${Math.round((Math.max(0, b) / mx) * 100)}%`,
              background: b > a ? "linear-gradient(90deg,var(--ap-n200),var(--ap-n400))" : "var(--ap-n700)",
            }}
          />
        </div>
      </div>
    </div>
  );
}

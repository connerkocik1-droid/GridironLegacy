"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRefreshable } from "@/lib/use-refresh";
import { player, proj, type LeagueShape } from "@/lib/roster";
import { scoringOf } from "@/lib/scoring-format";
import { optimalLineup } from "@/lib/start-rate";
import { openPlayer } from "@/lib/player-sheet";
import { gameFor, gameLabel, useNflGames } from "@/lib/use-nfl-games";
import { useHealthReport, healthOf } from "@/lib/use-player-health";
import { HEALTH_SHORT, type Health } from "@/lib/health";
import { usePositionRanks } from "@/lib/use-position-ranks";
import { ageOf } from "@/data/league-data";
import PlayerFace from "./PlayerFace";
import { AppView, GroupSkeleton, Note, RowGroup, type RowSpec, type RowTag } from "./RowList";

interface Feed {
  settings: LeagueShape | null;
  mine?: boolean;
  roster: string[];
  injuredReserve: string[];
  started: boolean;
  scores: Record<string, { points: number; statLine: string }>;
  irReturns?: string[];
  irLimit?: number;
  rosterCount?: number;
  rosterLimit?: number;
}

const ORDER = ["QB", "RB", "WR", "TE", "K", "D/ST"];
const SLOT_ORDER = ["QB", "RB", "WR", "TE", "FLEX", "K", "DST", "D/ST"];
const POLL_MS = 60_000;

/**
 * The League → Roster: the whole roster, never collapsed — the lineup best
 * ball is counting right now, then the bench, then injured reserve. Tapping
 * anybody opens his player sheet, which is where Trade, Drop and IR live.
 * From the Roster view in prototype/Pylon App.dc.html.
 */
export default function RosterView() {
  const [feed, setFeed] = useState<Feed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { games } = useNflGames();
  const report = useHealthReport();
  const ranks = usePositionRanks();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/lineup", { cache: "no-store" });
      if (res.status === 401) return setError("Sign in to see your roster.");
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

  useRefreshable(load);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    const t = setInterval(() => {
      if (document.visibilityState === "hidden") return;
      void load();
    }, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  // Live points once anybody has scored; his projection before that.
  const live = Boolean(feed?.started) && (feed?.roster ?? []).some((n) => feed?.scores?.[n] != null);
  const values = useMemo(() => {
    const out = new Map<string, number>();
    for (const name of feed?.roster ?? []) {
      out.set(name, live ? (feed?.scores?.[name]?.points ?? 0) : proj(name, scoringOf(feed?.settings)));
    }
    return out;
  }, [feed, live]);

  const slots = useMemo(
    () => (feed ? optimalLineup(feed.roster, feed.settings, values) : new Map<string, string>()),
    [feed, values],
  );

  if (error && !feed) {
    return (
      <AppView>
        <Note tag="ROSTER" tone="warn">{error}</Note>
      </AppView>
    );
  }
  if (!feed) {
    return (
      <AppView>
        <GroupSkeleton rows={10} />
        <GroupSkeleton rows={6} />
      </AppView>
    );
  }

  const scoring = scoringOf(feed.settings);
  const card = (name: string, slot: string | null, onIr = false): RowSpec => {
    const p = player(name);
    const pos = p?.p ?? "";
    const g = gameFor(games, p?.t);
    const status = g ? gameLabel(g) : p?.t ? "BYE" : "";
    const health = healthOf(report, name);
    const age = pos === "D/ST" ? null : ageOf({ n: name });
    const tags: RowTag[] = [];
    const rank = ranks.get(name);
    // The group already says who is counting; a flex is the one slot his
    // position does not tell you.
    if (slot && /^FLEX/.test(slot)) tags.push({ label: "FLEX", tone: "slot" });
    if (health) tags.push({ label: HEALTH_SHORT[health.status as Health], tone: "warn" });
    if (g?.state === "in") tags.push({ label: "LIVE", tone: "live" });
    const scored = feed.scores?.[name];
    const now = live ? (scored?.points ?? 0) : null;
    const projection = proj(name, scoring);
    return {
      key: `${slot ?? (onIr ? "ir" : "b")}:${name}`,
      hi: !!slot,
      logo: <PlayerFace name={name} size={32} />,
      title: age != null ? (
        <>
          <span>{name}</span>{" "}
          <span title={`Age ${age}`} style={{ fontWeight: 400, color: "var(--ap-n500)" }}>
            {age}
          </span>
        </>
      ) : (
        name
      ),
      tags,
      // Position, club, his game, and where he ranks at his position across
      // the league this season.
      sub: [pos, p?.t, status, rank].filter(Boolean).join(" · "),
      val: now != null ? now.toFixed(1) : projection.toFixed(1),
      valSub: now != null ? `PROJ ${projection.toFixed(1)}` : "PROJ",
      valColor: slot ? "var(--ap-a200)" : "var(--ap-n300)",
      onClick: () => openPlayer(name),
    };
  };

  const counting = feed.roster
    .filter((n) => slots.has(n))
    .sort((a, b) => {
      const sa = slots.get(a) ?? "";
      const sb = slots.get(b) ?? "";
      const ra = SLOT_ORDER.indexOf(sa.replace(/\d+$/, ""));
      const rb = SLOT_ORDER.indexOf(sb.replace(/\d+$/, ""));
      return ra - rb || sa.localeCompare(sb);
    });
  const bench = feed.roster
    .filter((n) => !slots.has(n))
    .sort((a, b) => {
      const pa = ORDER.indexOf(player(a)?.p ?? "");
      const pb = ORDER.indexOf(player(b)?.p ?? "");
      return (pa < 0 ? 99 : pa) - (pb < 0 ? 99 : pb) || (values.get(b) ?? 0) - (values.get(a) ?? 0);
    });
  const total = counting.reduce((s, n) => s + (values.get(n) ?? 0), 0);
  const returns = feed.irReturns ?? [];
  const over = feed.rosterCount != null && feed.rosterLimit != null && feed.rosterCount > feed.rosterLimit;
  const irLimit = Number(feed.irLimit ?? feed.settings?.ir ?? 0);

  if (!feed.roster.length && !feed.injuredReserve.length) {
    return (
      <AppView>
        <Note tag="EMPTY">Nothing here until the draft runs. Every franchise starts empty.</Note>
      </AppView>
    );
  }

  return (
    <AppView>
      {feed.mine !== false && returns.length ? (
        <Note tag="CLEARED" tone={over ? "warn" : "accent"}>
          {returns.join(", ")} {returns.length === 1 ? "is" : "are"} cleared to play
          {over
            ? ` and back on your ${feed.rosterLimit} — you are at ${feed.rosterCount}. Drop somebody before you can add anybody.`
            : ` and back on your ${feed.rosterLimit} — you have room.`}
        </Note>
      ) : null}
      {error ? <Note tag="ERROR" tone="warn">{error}</Note> : null}

      <RowGroup
        label="COUNTING NOW"
        note={`${total.toFixed(1)} ${live ? "pts" : "proj"} · best ball`}
        rows={counting.map((n) => card(n, slots.get(n) ?? null))}
      />
      <RowGroup
        label="BENCH"
        note={`${bench.length} player${bench.length === 1 ? "" : "s"}`}
        rows={bench.map((n) => card(n, null))}
        empty={{ title: "Nobody waiting", sub: "Every man you hold is counting." }}
      />
      {feed.injuredReserve.length ? (
        <RowGroup
          label="INJURED RESERVE"
          note={irLimit ? `${feed.injuredReserve.length} of ${irLimit}` : undefined}
          rows={feed.injuredReserve.map((n) => card(n, null, true))}
        />
      ) : null}
    </AppView>
  );
}

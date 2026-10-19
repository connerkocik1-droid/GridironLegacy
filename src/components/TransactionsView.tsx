"use client";

import { useCallback, useEffect, useState } from "react";
import { useRefreshable } from "@/lib/use-refresh";
import { openPlayer } from "@/lib/player-sheet";
import { AppView, Chips, GroupSkeleton, Note, RowGroup, type RowSpec } from "./RowList";

interface Entry {
  id: string;
  kind: string;
  player: string;
  at: string;
  franchise: string;
  who: string | null;
  mine: boolean;
  from: string | null;
  toWaivers: boolean;
  isPick: boolean;
}

/** The design's five kinds, and which stored kind each one reads. */
const FILTERS = ["All", "ADDED", "CLAIM", "RECEIVED", "SENT", "DROP"] as const;
type Filter = (typeof FILTERS)[number];
const SERVER: Record<Filter, string> = { All: "all", ADDED: "add", CLAIM: "waiver", RECEIVED: "trade", SENT: "trade", DROP: "drop" };

/** Added green, claimed amber, received accent, sent grey, dropped red. */
const TONE: Record<string, string> = {
  ADDED: "var(--ap-good-text)",
  CLAIM: "var(--ap-claim-text)",
  RECEIVED: "var(--ap-a300)",
  SENT: "var(--ap-n400)",
  DROP: "var(--ap-bad-text)",
};

function age(iso: string) {
  const h = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  if (h < 1) return `${Math.max(1, Math.round(h * 60))}M`;
  if (h < 24) return `${Math.round(h)}H`;
  return `${Math.round(h / 24)}D`;
}

function day(iso: string) {
  const at = new Date(iso);
  const today = new Date();
  const start = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((start(today) - start(at)) / 86_400_000);
  return diff <= 0 ? "TODAY" : diff === 1 ? "YESTERDAY" : "EARLIER";
}

/**
 * General Manager → Transactions: every move in the league, newest first,
 * grouped by day and colour-coded five ways — Added, Claimed, Received, Sent
 * and Dropped — with what the player has scored since. A trade is told from
 * the side that received him, or, filtered to Sent, from the side that let him
 * go. From the Transactions view in prototype/Pylon App.dc.html.
 */
export default function TransactionsView() {
  const [filter, setFilter] = useState<Filter>("All");
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [totals, setTotals] = useState<Record<string, { total: number }>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetch("/api/rankings", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((ranks) => ranks?.points && setTotals(ranks.points))
      .catch(() => {});
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/activity?kind=${SERVER[filter]}&page=${page}`, { cache: "no-store" });
      if (res.status === 401) return setError("Sign in to see the league's moves.");
      if (!res.ok) throw new Error(String(res.status));
      const body = await res.json();
      setEntries((was) => (page === 0 ? body.entries : [...(was ?? []), ...body.entries]));
      setHasMore(!!body.hasMore);
      setError(null);
    } catch {
      setError("Could not read the league's moves.");
    }
  }, [filter, page]);

  useRefreshable(load);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  if (error && !entries) {
    return (
      <AppView>
        <Note tag="TRANSACTIONS" tone="warn">{error}</Note>
      </AppView>
    );
  }

  const label = (e: Entry): Exclude<Filter, "All"> =>
    e.kind === "add" ? "ADDED" : e.kind === "waiver" ? "CLAIM" : e.kind === "drop" ? "DROP" : filter === "SENT" ? "SENT" : "RECEIVED";
  const first = (name: string | null, franchise: string) => (name ? name.split(" ")[0] : franchise);
  const verb = (e: Entry, k: string) =>
    k === "ADDED"
      ? `${first(e.who, e.franchise)} added from free agency`
      : k === "CLAIM"
        ? `${first(e.who, e.franchise)} claimed off waivers`
        : k === "DROP"
          ? `${first(e.who, e.franchise)} dropped${e.toWaivers ? " to waivers" : ""}`
          : k === "SENT"
            ? `${e.from ?? "A franchise"} sent to ${e.franchise}`
            : `${first(e.who, e.franchise)} received${e.from ? ` from ${e.from}` : ""}`;

  const groups = new Map<string, RowSpec[]>();
  for (const e of entries ?? []) {
    const k = label(e);
    const pts = !e.isPick ? totals[e.player]?.total : undefined;
    const d = day(e.at);
    groups.set(d, [
      ...(groups.get(d) ?? []),
      {
        key: e.id,
        title: e.player,
        titleColor: TONE[k],
        tags: [{ label: e.isPick ? "PICK" : k, tone: "flat" }],
        sub: `${verb(e, k)}${pts != null ? ` · ${pts.toFixed(1)} pts` : ""}`,
        val: age(e.at),
        valColor: "var(--ap-n500)",
        hi: e.mine,
        onClick: e.isPick ? undefined : () => openPlayer(e.player),
      },
    ]);
  }

  const days = [...groups.entries()];
  if (hasMore && days.length) {
    const [d, rows] = days[days.length - 1];
    days[days.length - 1] = [d, [...rows, { key: "__more", title: "Older moves", titleColor: "var(--ap-a300)", sub: "Load the next page", onClick: () => setPage((n) => n + 1) }]];
  }

  return (
    <AppView>
      <Chips
        options={[...FILTERS]}
        value={filter}
        onChange={(v) => {
          setFilter(v);
          setPage(0);
          setEntries(null);
        }}
        label="Kind of move"
      />
      {!entries ? (
        <GroupSkeleton rows={8} />
      ) : days.length ? (
        days.map(([d, rows]) => <RowGroup key={d} label={d} rows={rows} />)
      ) : (
        <Note tag="NOTHING YET">No {filter === "All" ? "moves" : filter.toLowerCase()} in the league yet.</Note>
      )}
    </AppView>
  );
}

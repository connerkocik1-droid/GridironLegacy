"use client";

import { useCallback, useEffect, useState } from "react";
import Skeleton from "./Skeleton";
import Link from "next/link";
import TeamCrest from "@/components/TeamCrest";
import { useLogos } from "@/lib/use-logos";

interface Entry {
  id: string;
  kind: string;
  player: string;
  at: string;
  managerId: string;
  franchise: string;
  who: string | null;
  mine: boolean;
  from: string | null;
  toWaivers: boolean;
  clearsAt: string | null;
  isPick: boolean;
}

interface Feed {
  me: { id: string };
  managers: { id: string; name: string; franchise: string; slot: string }[];
  total: number;
  page: number;
  hasMore: boolean;
  entries: Entry[];
}

const FILTERS: [string, string][] = [
  ["all", "Everything"],
  ["trade", "Trades"],
  ["waiver", "Claims"],
  ["add", "Signings"],
  ["drop", "Releases"],
];

/** The colour a move is filed under, so a column of them can be skimmed. */
const TONE: Record<string, string> = {
  trade: "var(--accent-link)",
  waiver: "var(--good)",
  add: "var(--good)",
  drop: "var(--warn)",
};

/** How long ago, at the resolution somebody actually cares about. */
function when(iso: string) {
  const at = new Date(iso);
  const mins = (Date.now() - at.getTime()) / 60_000;
  if (mins < 1) return "just now";
  if (mins < 60) return `${Math.round(mins)}m ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`;
  if (mins < 60 * 24 * 7) return `${Math.round(mins / (60 * 24))}d ago`;
  return at.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * One move, as a sentence.
 *
 * What a franchise dropped to make room is never mentioned here, because the
 * drop is its own entry a second earlier — saying it twice would make every
 * swap look like two swaps.
 */
function sentence(e: Entry) {
  const thing = e.isPick ? `the ${e.player}` : e.player;
  if (e.kind === "trade") return `acquired ${thing}${e.from ? ` from ${e.from}` : ""}`;
  if (e.kind === "waiver") return `claimed ${thing} off waivers`;
  if (e.kind === "add") return `signed ${thing}`;
  if (e.kind === "drop") return `released ${thing}${e.toWaivers ? " to waivers" : ""}`;
  return `${e.kind} ${thing}`;
}

const card: React.CSSProperties = {
  border: "1px solid rgb(var(--accent-rgb) / .22)",
  borderRadius: "var(--radius-lg)",
  background: "rgb(var(--surface-rgb) / .55)",
  overflow: "hidden",
};

function Row({ entry, logo }: { entry: Entry; logo: string | null }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "9px 16px",
        borderTop: "1px solid rgb(var(--accent-rgb) / .1)",
      }}
    >
      <TeamCrest franchise={entry.franchise} logo={logo} size={26} shape="box" fallback="empty" />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 13, lineHeight: 1.45 }}>
          <span style={{ fontFamily: "var(--font-heading)", fontSize: 14 }}>{entry.franchise}</span>{" "}
          <span style={{ color: "var(--text-muted)" }}>{sentence(entry)}</span>
        </div>
        <div style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 2 }}>
          <span
            style={{
              letterSpacing: ".14em",
              color: TONE[entry.kind] ?? "var(--text-dim)",
            }}
          >
            {entry.kind.toUpperCase()}
          </span>
          {" · "}
          {when(entry.at)}
          {entry.mine ? <span style={{ color: "var(--accent-link)" }}> · you</span> : null}
        </div>
      </div>
    </div>
  );
}

/**
 * The league's comings and goings.
 *
 * `limit` makes this the short version for a band of the home page: the same
 * rows, no filters, and a way through to the whole thing.
 */
export default function ActivityFeed({ limit }: { limit?: number } = {}) {
  const [feed, setFeed] = useState<Feed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState("all");
  const [manager, setManager] = useState("all");
  const [page, setPage] = useState(0);
  const logos = useLogos();
  const compact = limit != null;

  const load = useCallback(async () => {
    try {
      const url =
        `/api/activity?page=${page}&kind=${encodeURIComponent(kind)}` +
        `&manager=${encodeURIComponent(manager)}${limit ? `&limit=${limit}` : ""}`;
      const res = await fetch(url, { cache: "no-store" });
      if (res.status === 401) return setError("Sign in to see the league's moves.");
      if (res.status === 503) {
        const body = await res.json().catch(() => ({}));
        return setError(body.error ?? "The league database is not configured yet.");
      }
      if (!res.ok) throw new Error(String(res.status));
      setFeed(await res.json());
      setError(null);
    } catch {
      setError("Could not read the league's moves.");
    }
  }, [page, kind, manager, limit]);

  useEffect(() => {
    // Sets state only once the request resolves, not synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  if (error && !feed) {
    return <div style={{ fontSize: 12, color: "var(--warn)", padding: compact ? 0 : "0 0 20px" }}>{error}</div>;
  }
  if (!feed) {
    return <Skeleton rows={4} title={false} style={{ padding: 0 }} />;
  }

  if (feed.entries.length === 0) {
    return (
      <div style={{ ...card, padding: "16px" }}>
        <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6 }}>
          {kind === "all" && manager === "all"
            ? "Nobody has signed, dropped or traded anybody yet. Draft night is on the board, not here — this is what happens afterwards."
            : "Nothing under that filter."}
        </div>
      </div>
    );
  }

  const rows = (
    <div style={card}>
      {feed.entries.map((e) => (
        <Row key={e.id} entry={e} logo={logos[e.managerId] ?? null} />
      ))}
    </div>
  );

  if (compact) {
    return (
      <>
        {rows}
        <div style={{ marginTop: 10, fontSize: 11 }}>
          <Link
            href="/activity"
            style={{
              color: "var(--accent-link)",
              textDecoration: "none",
              // The only way through to the whole record, so it is a target
              // rather than a line of text somebody has to hit exactly.
              display: "inline-flex",
              alignItems: "center",
              minHeight: 34,
            }}
          >
            Every move the league has made →
          </Link>
        </div>
      </>
    );
  }

  return (
    <>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
          marginBottom: 12,
        }}
      >
        {/* Five of them, which is two rows on a phone. One rail instead, in
            the order they are asked for. */}
        <div
          className="gl-scroll-x"
          style={{ display: "flex", gap: 3, flexWrap: "nowrap", minWidth: 0, paddingBottom: 2 }}
        >
          {FILTERS.map(([value, label]) => (
            <button
              key={value}
              onClick={() => {
                setKind(value);
                setPage(0);
              }}
              style={{
                flex: "0 0 auto",
                whiteSpace: "nowrap",
                padding: "5px 9px",
                fontSize: 10,
                letterSpacing: ".1em",
                textTransform: "uppercase",
                border: `1px solid ${kind === value ? "rgb(var(--accent-bright-rgb) / .6)" : "rgb(var(--accent-rgb) / .24)"}`,
                background: kind === value ? "rgb(var(--accent-rgb) / .26)" : "transparent",
                color: kind === value ? "var(--text)" : "var(--text-muted)",
                borderRadius: "var(--radius-sm)",
                fontFamily: "inherit",
                cursor: "pointer",
              }}
            >
              {label}
            </button>
          ))}
        </div>

        <select
          value={manager}
          onChange={(e) => {
            setManager(e.target.value);
            setPage(0);
          }}
          aria-label="Franchise"
          style={{
            // Fills the line it wraps onto rather than hugging the right edge
            // of it, where on a phone it read as a stray control belonging to
            // nothing. On a desktop there is room for it beside the filters
            // and the margin still pushes it there.
            marginLeft: "auto",
            flex: "1 1 180px",
            maxWidth: "100%",
            padding: "5px 8px",
            fontSize: 11,
            background: "rgb(var(--sunken-rgb) / .8)",
            border: "1px solid rgb(var(--accent-rgb) / .28)",
            borderRadius: "var(--radius-sm)",
            color: "var(--text)",
            fontFamily: "inherit",
          }}
        >
          <option value="all">Every franchise</option>
          {feed.managers.map((m) => (
            <option key={m.id} value={m.id}>
              {m.franchise}
            </option>
          ))}
        </select>
      </div>

      {rows}

      {feed.total > feed.entries.length ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "11px 2px",
            flexWrap: "wrap",
          }}
        >
          <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
            {feed.page * 40 + 1}–{feed.page * 40 + feed.entries.length} of {feed.total}
          </span>
          <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
            <button
              onClick={() => setPage((n) => Math.max(0, n - 1))}
              disabled={feed.page === 0}
              style={pager(feed.page > 0)}
            >
              Back
            </button>
            <button
              onClick={() => setPage((n) => n + 1)}
              disabled={!feed.hasMore}
              style={pager(feed.hasMore)}
            >
              More
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}

const pager = (enabled: boolean): React.CSSProperties => ({
  padding: "6px 12px",
  fontSize: 10,
  letterSpacing: ".1em",
  textTransform: "uppercase",
  border: `1px solid ${enabled ? "rgb(var(--accent-bright-rgb) / .6)" : "rgb(var(--accent-rgb) / .2)"}`,
  background: "transparent",
  color: enabled ? "var(--accent-text)" : "var(--text-faint)",
  borderRadius: "var(--radius-sm)",
  fontFamily: "inherit",
  cursor: enabled ? "pointer" : "default",
});

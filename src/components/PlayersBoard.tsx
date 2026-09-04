"use client";

import { useCallback, useEffect, useState } from "react";
import Skeleton from "./Skeleton";
import { headshot } from "@/data/league-data";
import PlayerName from "./PlayerName";
import TeamMark from "./TeamMark";
import { flagColor, flagsFor, player, proj } from "@/lib/roster";

const BLANK =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

const POSITIONS = ["ALL", "QB", "RB", "WR", "TE", "K", "D/ST"];

interface FreeAgent {
  name: string;
  position: string;
  team: string;
  adp: number;
  posRank: string;
  bye: number;
  /** Set while he is on the waiver wire: the moment claims on him are settled. */
  clearsAt: string | null;
}

interface Wired {
  name: string;
  position: string;
  team: string;
  clearsAt: string;
  /** Whether this manager is the one who dropped him. */
  mine: boolean;
}

interface Claim {
  id: string;
  add_player: string;
  drop_player: string | null;
  claim_order: number;
  status: string;
  reason: string | null;
}

interface Feed {
  me: { id: string; franchise: string; waiver_priority: number };
  mode: "waivers" | "open" | "all";
  waiverDays: number;
  capacity: number;
  held: number;
  roster: { player_name: string; lineup_slot: string }[];
  claims: Claim[];
  wire: Wired[];
  total: number;
  page: number;
  hasMore: boolean;
  players: FreeAgent[];
}

/**
 * When a player stops being claimable, said the way somebody would say it.
 *
 * Near enough to matter is counted in hours, because "clears Wednesday" is no
 * use to a manager deciding whether to bother claiming tonight.
 */
function clears(iso: string) {
  const at = new Date(iso);
  const hours = (at.getTime() - Date.now()) / 3_600_000;
  if (hours <= 0) return "clears at the next run";
  if (hours < 1) return "clears within the hour";
  if (hours < 24) return `clears in ${Math.round(hours)}h`;
  return `clears ${at.toLocaleDateString(undefined, { weekday: "long" })} ${at.toLocaleTimeString(
    undefined,
    { hour: "numeric", minute: "2-digit" },
  )}`;
}

const card: React.CSSProperties = {
  border: "1px solid rgb(var(--accent-rgb) / .22)",
  borderRadius: "var(--radius-lg)",
  background: "rgb(var(--surface-rgb) / .55)",
  overflow: "hidden",
};

const button = (enabled: boolean): React.CSSProperties => ({
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
  flex: "0 0 auto",
});

export default function PlayersBoard() {
  const [feed, setFeed] = useState<Feed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [filter, setFilter] = useState("ALL");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  // The player being added, while we ask which one to drop for him.
  const [pendingAdd, setPendingAdd] = useState<string | null>(null);
  // Players this manager is keeping an eye on. Kept apart from the feed
  // because it changes on its own clock — a star does not need the whole pool
  // re-read behind it.
  const [watching, setWatching] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const url = `/api/players?position=${encodeURIComponent(filter)}&q=${encodeURIComponent(search)}&page=${page}`;
      const res = await fetch(url, { cache: "no-store" });
      if (res.status === 401) return setError("Sign in to add players.");
      if (res.status === 503) {
        const body = await res.json().catch(() => ({}));
        return setError(body.error ?? "The league database is not configured yet.");
      }
      if (!res.ok) throw new Error(String(res.status));
      setFeed(await res.json());
      setError(null);
    } catch {
      setError("Could not load the player pool.");
    }
  }, [filter, search, page]);

  const loadWatchlist = useCallback(async () => {
    try {
      const res = await fetch("/api/watchlist", { cache: "no-store" });
      if (!res.ok) return;
      const body = await res.json();
      setWatching(new Set<string>(body.players ?? []));
    } catch {
      // A star nobody can draw is a star nobody has set. The page works.
    }
  }, []);

  useEffect(() => {
    // Sets state only once the request resolves, not synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadWatchlist();
  }, [loadWatchlist]);

  /**
   * Starts or stops watching a player.
   *
   * The star flips before the request lands and flips back if it fails. A
   * watchlist is a note to yourself; waiting on a round trip to see it change
   * is more ceremony than the thing deserves.
   */
  async function watch(name: string, on: boolean) {
    setWatching((prev) => {
      const next = new Set(prev);
      if (on) next.add(name);
      else next.delete(name);
      return next;
    });

    try {
      const res = on
        ? await fetch("/api/watchlist", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ player: name }),
          })
        : await fetch(`/api/watchlist?player=${encodeURIComponent(name)}`, { method: "DELETE" });
      if (!res.ok) throw new Error(String(res.status));
    } catch {
      setWatching((prev) => {
        const next = new Set(prev);
        if (on) next.delete(name);
        else next.add(name);
        return next;
      });
      setError("Could not change your watchlist.");
    }
  }

  const full = feed != null && feed.held >= feed.capacity;

  async function add(name: string, drop: string | null) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      const res = await fetch("/api/waivers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ add: name, drop }),
      });
      const body = await res.json().catch(() => ({}));

      if (!res.ok) setError(body.error ?? "That did not go through.");
      else
        setNotice(
          body.mode === "now"
            ? `${name} is on your roster.${drop ? ` ${drop} went to waivers.` : ""}`
            : `Claim placed for ${name}. It settles on the next waiver run.`,
        );

      setPendingAdd(null);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function withdraw(id: string) {
    if (busy) return;
    setBusy(true);
    try {
      await fetch(`/api/waivers?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function drop(name: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/waivers", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ drop: name }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) setError(body.error ?? "Could not drop him.");
      else
        setNotice(
          body.clearsAt
            ? `${name} is on waivers — he ${clears(body.clearsAt)}.`
            : `${name} was dropped.`,
        );
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (error && !feed) {
    return <div style={{ padding: "24px 26px", color: "var(--warn)" }}>{error}</div>;
  }
  if (!feed) {
    return <Skeleton rows={6} />;
  }

  const pending = feed.claims.filter((c) => c.status === "pending");
  const settled = feed.claims.filter((c) => c.status !== "pending").slice(0, 5);

  return (
    <div style={{ padding: "24px 26px 40px" }}>
      <div style={{ fontSize: 10, letterSpacing: ".32em", color: "var(--text-dim)" }}>
        {feed.mode === "open" ? "OPEN MARKET" : "WAIVERS"}
      </div>
      <h1
        style={{
          fontFamily: "var(--font-heading)",
          fontSize: "clamp(30px, 8.4vw, 40px)",
          letterSpacing: "-.035em",
          margin: "8px 0 6px",
          fontWeight: 500,
        }}
      >
        Free agents
      </h1>
      {/* The rule, and then the two numbers. This was one paragraph carrying
          five different facts, six lines deep on a phone, above the list it
          was explaining — and the two things in it a manager actually comes
          back to check, their waiver priority and how full their roster is,
          were buried in the middle of a sentence. The prose says the rule
          once; the numbers are numbers. The star's own tooltip explains the
          star, so the line about it has gone. */}
      <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 12px", maxWidth: "72ch", lineHeight: 1.6 }}>
        {feed.mode === "open"
          ? "Adds land immediately — first come, first served, and a dropped player goes straight back into this list."
          : feed.mode === "all"
            ? "Every pickup here is a claim, settled on the next waiver run, best priority first."
            : `Anybody on this list is yours on the spot; a player somebody dropped goes on waivers for ${feed.waiverDays === 1 ? "a day" : `${feed.waiverDays} days`} first and can only be claimed.`}
      </p>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "0 0 18px" }}>
        {feed.mode === "open" ? null : (
          <Fact
            label="WAIVER PRIORITY"
            value={`#${feed.me.waiver_priority}`}
            title="Claims settle best priority first. Winning one sends you to the back."
          />
        )}
        <Fact
          label="ROSTER"
          value={`${feed.held} / ${feed.capacity}`}
          warn={full}
          title={
            full
              ? "Full — you must drop somebody to add anybody"
              : `${feed.capacity - feed.held} more before you have to drop somebody`
          }
        />
      </div>

      {notice ? (
        <div style={{ fontSize: 12, color: "var(--good)", marginBottom: 12 }}>{notice}</div>
      ) : null}
      {error ? (
        <div style={{ fontSize: 12, color: "var(--warn)", marginBottom: 12 }}>{error}</div>
      ) : null}

      {pendingAdd ? (
        <div style={{ ...card, padding: "14px 16px", marginBottom: 14 }}>
          <h6 style={{ margin: "0 0 4px", color: "var(--accent-text)" }}>Drop someone for {pendingAdd}</h6>
          <p style={{ fontSize: 11.5, color: "var(--text-muted)", margin: "0 0 10px" }}>
            Your roster is full. Pick who leaves, or cancel.
          </p>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {feed.roster
              .filter((r) => r.lineup_slot !== "IR")
              .map((r) => (
                <button
                  key={r.player_name}
                  onClick={() => add(pendingAdd, r.player_name)}
                  disabled={busy}
                  style={{ ...button(!busy), textTransform: "none", fontSize: 11 }}
                >
                  {r.player_name}
                </button>
              ))}
            <button
              onClick={() => setPendingAdd(null)}
              style={{ ...button(true), borderColor: "rgb(var(--accent-rgb) / .24)", color: "var(--text-muted)" }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {feed.wire.length ? (
        <div style={{ ...card, marginBottom: 14 }}>
          <div
            style={{
              padding: "12px 16px",
              display: "flex",
              gap: 10,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <h6 style={{ margin: 0, color: "var(--warn)" }}>On waivers</h6>
            <span style={{ fontSize: 10, letterSpacing: ".14em", color: "var(--text-dim)" }}>
              {feed.wire.length} RECENTLY DROPPED
            </span>
            <span style={{ fontSize: 11, color: "var(--text-dim)", marginLeft: "auto" }}>
              Claims only until each one clears.
            </span>
          </div>
          {feed.wire.map((w) => {
            const claimed = pending.some((c) => c.add_player === w.name);
            return (
              <div
                key={w.name}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "9px 16px",
                  borderTop: "1px solid rgb(var(--accent-rgb) / .12)",
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={headshot(w.name) || BLANK}
                  alt=""
                  width={26}
                  height={26}
                  style={{
                    borderRadius: "50%",
                    objectFit: "contain",
                    border: "1px solid rgb(var(--warn-rgb) / .3)",
                    background: "rgb(var(--raised-rgb) / .7)",
                    flex: "0 0 auto",
                  }}
                />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontFamily: "var(--font-heading)", fontSize: 14 }}>
                    {w.name}
                    {w.position ? (
                      <span style={{ color: "var(--text-dim)", fontSize: 11 }}> · {w.position}</span>
                    ) : null}
                  </div>
                  <div style={{ fontSize: 10, color: "var(--warn)", marginTop: 2 }}>
                    {clears(w.clearsAt)}
                    {w.mine ? <span style={{ color: "var(--text-dim)" }}> · you dropped him</span> : null}
                  </div>
                </div>
                <button
                  onClick={() => (full ? setPendingAdd(w.name) : add(w.name, null))}
                  disabled={busy || claimed}
                  style={button(!busy && !claimed)}
                >
                  {claimed ? "Claimed" : "Claim"}
                </button>
              </div>
            );
          })}
        </div>
      ) : null}

      {pending.length ? (
        <div style={{ ...card, marginBottom: 14 }}>
          <div style={{ padding: "12px 16px", display: "flex", gap: 10, alignItems: "center" }}>
            <h6 style={{ margin: 0, color: "var(--accent-text)" }}>Your pending claims</h6>
            <span style={{ fontSize: 10, letterSpacing: ".14em", color: "var(--text-dim)" }}>
              {pending.length} QUEUED
            </span>
          </div>
          {pending.map((c) => (
            <div
              key={c.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "9px 16px",
                borderTop: "1px solid rgb(var(--accent-rgb) / .12)",
              }}
            >
              <span style={{ fontFamily: "var(--font-heading)", fontSize: 14, flex: 1, minWidth: 0 }}>
                {c.add_player}
                {c.drop_player ? (
                  <span style={{ fontSize: 11, color: "var(--text-dim)" }}> — dropping {c.drop_player}</span>
                ) : null}
              </span>
              <button onClick={() => withdraw(c.id)} disabled={busy} style={button(!busy)}>
                Withdraw
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {settled.length ? (
        <div style={{ ...card, marginBottom: 14 }}>
          <div style={{ padding: "12px 16px" }}>
            <h6 style={{ margin: 0, color: "var(--text-muted)" }}>Recently settled</h6>
          </div>
          {settled.map((c) => (
            <div
              key={c.id}
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: 9,
                padding: "8px 16px",
                borderTop: "1px solid rgb(var(--accent-rgb) / .12)",
              }}
            >
              <span
                style={{
                  fontSize: 10,
                  letterSpacing: ".14em",
                  width: 60,
                  flex: "0 0 auto",
                  color: c.status === "won" ? "var(--good)" : "var(--text-dim)",
                }}
              >
                {c.status.toUpperCase()}
              </span>
              <span style={{ fontSize: 13, minWidth: 0, flex: 1 }}>{c.add_player}</span>
              {c.reason ? (
                <span style={{ fontSize: 10.5, color: "var(--text-dim)" }}>{c.reason}</span>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      <div style={card}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "12px 16px",
            borderBottom: "1px solid rgb(var(--accent-rgb) / .18)",
            flexWrap: "wrap",
          }}
        >
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
            placeholder="Search players"
            style={{
              padding: "6px 10px",
              background: "rgb(var(--sunken-rgb) / .8)",
              border: "1px solid rgb(var(--accent-rgb) / .28)",
              borderRadius: "var(--radius-sm)",
              color: "var(--text)",
              font: "inherit",
              fontSize: 12,
            }}
          />
          <div style={{ display: "flex", gap: 3, marginLeft: "auto", flexWrap: "wrap" }}>
            {POSITIONS.map((pos) => (
              <button
                key={pos}
                onClick={() => {
                  setFilter(pos);
                  setPage(0);
                }}
                style={{
                  padding: "5px 9px",
                  fontSize: 10,
                  letterSpacing: ".1em",
                  border: `1px solid ${filter === pos ? "rgb(var(--accent-bright-rgb) / .6)" : "rgb(var(--accent-rgb) / .24)"}`,
                  background: filter === pos ? "rgb(var(--accent-rgb) / .26)" : "transparent",
                  color: filter === pos ? "var(--text)" : "var(--text-muted)",
                  borderRadius: "var(--radius-sm)",
                  fontFamily: "inherit",
                  cursor: "pointer",
                }}
              >
                {pos === "D/ST" ? "DST" : pos}
              </button>
            ))}
          </div>
        </div>

        {feed.players.length === 0 ? (
          <div style={{ padding: 16, fontSize: 12, color: "var(--text-dim)" }}>Nobody left here.</div>
        ) : null}

        {feed.players.map((p) => {
          const claimed = feed.claims.some(
            (c) => c.add_player === p.name && c.status === "pending",
          );
          // On the wire he can only be claimed, whatever the league's mode.
          const waived = p.clearsAt != null;
          const flags = flagsFor(p.name);

          return (
            <div
              key={p.name}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 11,
                padding: "9px 16px",
                borderTop: "1px solid rgb(var(--accent-rgb) / .1)",
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={headshot(p.name) || BLANK}
                alt=""
                width={28}
                height={28}
                style={{
                  borderRadius: "50%",
                  objectFit: "contain",
                  border: "1px solid rgb(var(--accent-rgb) / .25)",
                  background: "rgb(var(--raised-rgb) / .7)",
                  flex: "0 0 auto",
                }}
              />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <PlayerName name={p.name} style={{ fontFamily: "var(--font-heading)", fontSize: 14 }} />
                  <TeamMark team={p.team} />
                  {flags.map((f) => (
                    <span
                      key={f.label}
                      style={{
                        fontSize: 10,
                        letterSpacing: ".12em",
                        padding: "2px 5px",
                        borderRadius: 2,
                        border: `1px solid ${flagColor(f.kind)}66`,
                        color: flagColor(f.kind),
                      }}
                    >
                      {f.label}
                    </span>
                  ))}
                </div>
                <div style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 2 }}>
                  {p.posRank} · ADP {p.adp} · bye {p.bye} · proj {proj(p.name).toFixed(1)}
                  {p.clearsAt ? (
                    <span style={{ color: "var(--warn)" }}> · on waivers, {clears(p.clearsAt)}</span>
                  ) : null}
                </div>
              </div>

              {/* A star rather than a word: it sits beside the button that
                  actually costs something, and confusing the two would be
                  expensive. */}
              <button
                onClick={() => void watch(p.name, !watching.has(p.name))}
                aria-pressed={watching.has(p.name)}
                aria-label={
                  watching.has(p.name) ? `Stop watching ${p.name}` : `Watch ${p.name}`
                }
                title={
                  watching.has(p.name)
                    ? "You are watching him — his news shows on your home page"
                    : "Watch him, and his news shows on your home page"
                }
                style={{
                  padding: "6px 9px",
                  fontSize: 13,
                  lineHeight: 1,
                  border: `1px solid ${watching.has(p.name) ? "rgb(var(--warn-rgb) / .55)" : "rgb(var(--accent-rgb) / .22)"}`,
                  background: "transparent",
                  color: watching.has(p.name) ? "var(--warn)" : "var(--text-faint)",
                  borderRadius: "var(--radius-sm)",
                  fontFamily: "inherit",
                  cursor: "pointer",
                  flex: "0 0 auto",
                }}
              >
                {watching.has(p.name) ? "★" : "☆"}
              </button>

              <button
                onClick={() => (full ? setPendingAdd(p.name) : add(p.name, null))}
                disabled={busy || claimed}
                style={button(!busy && !claimed)}
              >
                {claimed
                  ? "Claimed"
                  : waived || feed.mode === "all"
                    ? "Claim"
                    : "Add"}
              </button>
            </div>
          );
        })}

        {feed.total > feed.players.length ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "11px 16px",
              borderTop: "1px solid rgb(var(--accent-rgb) / .18)",
            }}
          >
            <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
              {feed.page * 60 + 1}–{feed.page * 60 + feed.players.length} of {feed.total}
            </span>
            <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
              <button
                onClick={() => setPage((n) => Math.max(0, n - 1))}
                disabled={feed.page === 0}
                style={button(feed.page > 0)}
              >
                Back
              </button>
              <button
                onClick={() => setPage((n) => n + 1)}
                disabled={!feed.hasMore}
                style={button(feed.hasMore)}
              >
                More
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <div style={{ ...card, marginTop: 14 }}>
        <div style={{ padding: "12px 16px" }}>
          <h6 style={{ margin: 0, color: "var(--text-muted)" }}>Your roster</h6>
        </div>
        {feed.roster.map((r) => {
          const p = player(r.player_name);
          return (
            <div
              key={r.player_name}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "8px 16px",
                borderTop: "1px solid rgb(var(--accent-rgb) / .1)",
              }}
            >
              <span
                style={{
                  fontSize: 10,
                  letterSpacing: ".12em",
                  width: 38,
                  flex: "0 0 auto",
                  color: r.lineup_slot === "IR" ? "var(--text-faint)" : "var(--accent-link)",
                }}
              >
                {r.lineup_slot === "IR"
                  ? "IR"
                  : player(r.player_name)?.p === "D/ST"
                    ? "DST"
                    : (player(r.player_name)?.p ?? "—")}
              </span>
              <span style={{ fontSize: 13, minWidth: 0, flex: 1 }}>
                {r.player_name}
                {p ? <span style={{ color: "var(--text-dim)", fontSize: 11 }}> · {p.p}</span> : null}
              </span>
              {/* Just "Drop": where he goes afterwards is the page's subject
                  above and the notice below, and a three-word button squeezes
                  the name it sits beside off a phone screen. */}
              <button onClick={() => drop(r.player_name)} disabled={busy} style={button(!busy)}>
                Drop
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * One number worth checking, said as a number.
 *
 * Waiver priority and roster space are the two facts on this page that change
 * week to week and that a manager opens it to look up. Inside a paragraph they
 * are a sentence to read; as a pair of chips they are answered at a glance,
 * and the roster one goes amber the moment it means "you cannot add anybody".
 */
function Fact({
  label,
  value,
  title,
  warn,
}: {
  label: string;
  value: string;
  title: string;
  warn?: boolean;
}) {
  return (
    <span
      title={title}
      style={{
        display: "inline-flex",
        alignItems: "baseline",
        gap: 7,
        padding: "6px 10px",
        borderRadius: "var(--radius-sm)",
        border: `1px solid ${warn ? "rgb(var(--warn-rgb) / .5)" : "rgb(var(--accent-rgb) / .24)"}`,
        background: warn ? "rgb(var(--warn-rgb) / .08)" : "rgb(var(--surface-rgb) / .55)",
      }}
    >
      <span style={{ fontSize: 10, letterSpacing: ".14em", color: warn ? "var(--warn)" : "var(--text-dim)" }}>
        {label}
      </span>
      <span
        style={{
          fontFamily: "var(--font-heading)",
          fontSize: 13,
          color: warn ? "var(--warn)" : "var(--text)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </span>
    </span>
  );
}

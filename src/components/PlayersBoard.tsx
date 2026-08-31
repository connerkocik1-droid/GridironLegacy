"use client";

import { useCallback, useEffect, useState } from "react";
import { headshot, logo } from "@/data/league-data";
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
  mode: "waivers" | "open";
  capacity: number;
  held: number;
  roster: { player_name: string; lineup_slot: string }[];
  claims: Claim[];
  total: number;
  page: number;
  hasMore: boolean;
  players: FreeAgent[];
}

const card: React.CSSProperties = {
  border: "1px solid rgba(145,132,217,.22)",
  borderRadius: "var(--radius-lg)",
  background: "rgba(26,28,43,.55)",
  overflow: "hidden",
};

const button = (enabled: boolean): React.CSSProperties => ({
  padding: "6px 12px",
  fontSize: 10,
  letterSpacing: ".1em",
  textTransform: "uppercase",
  border: `1px solid ${enabled ? "rgba(181,171,252,.6)" : "rgba(145,132,217,.2)"}`,
  background: "transparent",
  color: enabled ? "#d2cefd" : "#5a5d6e",
  borderRadius: "var(--radius-sm)",
  font: "inherit",
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

  useEffect(() => {
    // Sets state only once the request resolves, not synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

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
          body.mode === "open"
            ? `${name} is on your roster.${drop ? ` ${drop} was dropped.` : ""}`
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
      else setNotice(`${name} was dropped.`);
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (error && !feed) {
    return <div style={{ padding: "24px 26px", color: "#e0b573" }}>{error}</div>;
  }
  if (!feed) {
    return <div style={{ padding: "24px 26px", color: "#75798c" }}>Reading the pool…</div>;
  }

  const pending = feed.claims.filter((c) => c.status === "pending");
  const settled = feed.claims.filter((c) => c.status !== "pending").slice(0, 5);

  return (
    <div style={{ padding: "24px 26px 40px" }}>
      <div style={{ fontSize: 9, letterSpacing: ".32em", color: "#75798c" }}>
        {feed.mode === "open" ? "OPEN MARKET" : "WAIVERS"}
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
        Free agents
      </h1>
      <p style={{ fontSize: 12, color: "#9397ab", margin: "0 0 18px", maxWidth: "72ch", lineHeight: 1.6 }}>
        {feed.mode === "open"
          ? "Adds land immediately — first come, first served."
          : `Claims are settled on the next waiver run, best priority first. You are number ${feed.me.waiver_priority}; winning a claim sends you to the back.`}{" "}
        Your roster holds {feed.held} of {feed.capacity}
        {full ? " — you must drop someone to add anyone." : "."}
      </p>

      {notice ? (
        <div style={{ fontSize: 12, color: "#7fd1a8", marginBottom: 12 }}>{notice}</div>
      ) : null}
      {error ? (
        <div style={{ fontSize: 12, color: "#e0b573", marginBottom: 12 }}>{error}</div>
      ) : null}

      {pendingAdd ? (
        <div style={{ ...card, padding: "14px 16px", marginBottom: 14 }}>
          <h6 style={{ margin: "0 0 4px", color: "#d2cefd" }}>Drop someone for {pendingAdd}</h6>
          <p style={{ fontSize: 11.5, color: "#9397ab", margin: "0 0 10px" }}>
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
              style={{ ...button(true), borderColor: "rgba(145,132,217,.24)", color: "#9397ab" }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {pending.length ? (
        <div style={{ ...card, marginBottom: 14 }}>
          <div style={{ padding: "12px 16px", display: "flex", gap: 10, alignItems: "center" }}>
            <h6 style={{ margin: 0, color: "#d2cefd" }}>Your pending claims</h6>
            <span style={{ fontSize: 10, letterSpacing: ".14em", color: "#75798c" }}>
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
                borderTop: "1px solid rgba(145,132,217,.12)",
              }}
            >
              <span style={{ fontFamily: "var(--font-heading)", fontSize: 14, flex: 1, minWidth: 0 }}>
                {c.add_player}
                {c.drop_player ? (
                  <span style={{ fontSize: 11, color: "#75798c" }}> — dropping {c.drop_player}</span>
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
            <h6 style={{ margin: 0, color: "#9397ab" }}>Recently settled</h6>
          </div>
          {settled.map((c) => (
            <div
              key={c.id}
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: 9,
                padding: "8px 16px",
                borderTop: "1px solid rgba(145,132,217,.12)",
              }}
            >
              <span
                style={{
                  fontSize: 9,
                  letterSpacing: ".14em",
                  width: 60,
                  flex: "0 0 auto",
                  color: c.status === "won" ? "#7fd1a8" : "#75798c",
                }}
              >
                {c.status.toUpperCase()}
              </span>
              <span style={{ fontSize: 13, minWidth: 0, flex: 1 }}>{c.add_player}</span>
              {c.reason ? (
                <span style={{ fontSize: 10.5, color: "#75798c" }}>{c.reason}</span>
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
            borderBottom: "1px solid rgba(145,132,217,.18)",
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
              background: "rgba(20,22,35,.8)",
              border: "1px solid rgba(145,132,217,.28)",
              borderRadius: "var(--radius-sm)",
              color: "#e9e9ed",
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
                  border: `1px solid ${filter === pos ? "rgba(181,171,252,.6)" : "rgba(145,132,217,.24)"}`,
                  background: filter === pos ? "rgba(145,132,217,.26)" : "transparent",
                  color: filter === pos ? "#e9e9ed" : "#9397ab",
                  borderRadius: "var(--radius-sm)",
                  font: "inherit",
                  cursor: "pointer",
                }}
              >
                {pos === "D/ST" ? "DST" : pos}
              </button>
            ))}
          </div>
        </div>

        {feed.players.length === 0 ? (
          <div style={{ padding: 16, fontSize: 12, color: "#75798c" }}>Nobody left here.</div>
        ) : null}

        {feed.players.map((p) => {
          const claimed = feed.claims.some(
            (c) => c.add_player === p.name && c.status === "pending",
          );
          const flags = flagsFor(p.name);

          return (
            <div
              key={p.name}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 11,
                padding: "9px 16px",
                borderTop: "1px solid rgba(145,132,217,.1)",
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
                  border: "1px solid rgba(145,132,217,.25)",
                  background: "rgba(35,37,50,.7)",
                  flex: "0 0 auto",
                }}
              />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <span style={{ fontFamily: "var(--font-heading)", fontSize: 14 }}>{p.name}</span>
                  {p.team ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={logo(p.team)}
                      alt=""
                      width={13}
                      height={13}
                      style={{ objectFit: "contain", opacity: 0.8 }}
                    />
                  ) : null}
                  {flags.map((f) => (
                    <span
                      key={f.label}
                      style={{
                        fontSize: 8,
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
                <div style={{ fontSize: 10, color: "#75798c", marginTop: 2 }}>
                  {p.posRank} · ADP {p.adp} · bye {p.bye} · proj {proj(p.name).toFixed(1)}
                </div>
              </div>

              <button
                onClick={() => (full ? setPendingAdd(p.name) : add(p.name, null))}
                disabled={busy || claimed}
                style={button(!busy && !claimed)}
              >
                {claimed ? "Claimed" : feed.mode === "open" ? "Add" : "Claim"}
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
              borderTop: "1px solid rgba(145,132,217,.18)",
            }}
          >
            <span style={{ fontSize: 11, color: "#75798c" }}>
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
          <h6 style={{ margin: 0, color: "#9397ab" }}>Your roster</h6>
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
                borderTop: "1px solid rgba(145,132,217,.1)",
              }}
            >
              <span
                style={{
                  fontSize: 9,
                  letterSpacing: ".12em",
                  width: 38,
                  flex: "0 0 auto",
                  color: r.lineup_slot === "BENCH" || r.lineup_slot === "IR" ? "#5a5d6e" : "#b5abfc",
                }}
              >
                {r.lineup_slot === "D/ST" ? "DST" : r.lineup_slot}
              </span>
              <span style={{ fontSize: 13, minWidth: 0, flex: 1 }}>
                {r.player_name}
                {p ? <span style={{ color: "#75798c", fontSize: 11 }}> · {p.p}</span> : null}
              </span>
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

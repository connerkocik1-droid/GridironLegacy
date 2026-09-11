"use client";

import { useState } from "react";
import type { TradeBallot } from "@/lib/home-types";

/**
 * A deal between two other managers, waiting on this one's vote.
 *
 * A trade in this league is the league's business, so it sits on the front
 * page rather than on the trade desk. The desk is where you go when you are
 * shopping; a vote is something eleven other people are waiting on you for,
 * and it has no business being somewhere you only look when you feel like it.
 *
 * A card leaves the moment you have voted. What it does not do is tell you
 * how the vote is going before you have cast one — the count is on the card
 * because a league that cannot see the count cannot tell an unpopular trade
 * from an unnoticed one, but nothing here nudges either way.
 */

/** "closes in 14h", or "closing now" once it has run out. */
function closesIn(iso: string | null): string {
  if (!iso) return "";
  const ms = Date.parse(iso) - Date.now();
  if (!Number.isFinite(ms)) return "";
  if (ms <= 0) return "closing now";
  const hours = Math.floor(ms / 3_600_000);
  if (hours >= 24) {
    const days = Math.round(hours / 24);
    return `closes in ${days} day${days === 1 ? "" : "s"}`;
  }
  if (hours >= 1) return `closes in ${hours}h`;
  return `closes in ${Math.max(1, Math.round(ms / 60_000))}m`;
}

const listOf = (names: string[], picks: number): string[] => {
  const items = [...names];
  if (picks) items.push(picks === 1 ? "1 draft pick" : `${picks} draft picks`);
  return items.length ? items : ["Nothing"];
};

/** One franchise and what leaves it. */
function Side({ team, items }: { team: string; items: string[] }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div
        style={{
          fontSize: 10,
          letterSpacing: ".16em",
          color: "var(--text-dim)",
          marginBottom: 4,
          overflowWrap: "anywhere",
        }}
      >
        {team.toUpperCase()} SENDS
      </div>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 3 }}>
        {items.map((item) => (
          <li
            key={item}
            style={{
              display: "flex",
              gap: 7,
              fontSize: 12.5,
              color: "var(--text-2)",
              lineHeight: 1.5,
            }}
          >
            <span aria-hidden style={{ color: "var(--accent)", flex: "0 0 auto" }}>
              •
            </span>
            <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function TradeBallots({
  ballots,
  onVoted,
}: {
  ballots: TradeBallot[];
  onVoted?: () => void;
}) {
  // Voted-on cards go the moment the answer is in, rather than waiting for the
  // next poll to notice. Held here so a slow network does not leave somebody
  // pressing veto twice.
  const [done, setDone] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const open = ballots.filter((b) => !done[b.id]);
  if (!open.length) return null;

  async function cast(id: string, vote: "veto" | "approve") {
    setBusy(id);
    setFailed(null);
    try {
      const res = await fetch(`/api/trades/${id}/vote`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ vote }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setFailed(body.error ?? "Your vote did not go through.");
        return;
      }
      setDone((d) => ({ ...d, [id]: vote }));
      onVoted?.();
    } catch {
      setFailed("Your vote did not go through.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div style={{ display: "grid", gap: 8, margin: "14px 0 0" }}>
      {open.map((b) => {
        const closing = closesIn(b.closesAt);
        return (
          <div
            key={b.id}
            style={{
              border: "1px solid rgb(var(--accent-rgb) / .42)",
              borderRadius: "var(--radius-md)",
              background: "rgb(var(--accent-rgb) / .07)",
              padding: "12px 14px",
            }}
          >
            <div
              style={{
                display: "flex",
                gap: 10,
                alignItems: "baseline",
                justifyContent: "space-between",
                flexWrap: "wrap",
              }}
            >
              <div style={{ fontSize: 10, letterSpacing: ".2em", color: "var(--accent)" }}>
                LEAGUE VOTE
              </div>
              {/* What it takes either way, said plainly. Four of anything is a
                  number nobody can infer from a progress bar. */}
              <div style={{ fontSize: 11, color: "var(--text-dim)" }}>
                {b.vetoes}/{b.bar} veto · {b.approvals}/{b.bar} approve
                {closing ? ` · ${closing}` : ""}
              </div>
            </div>

            <div
              style={{
                fontFamily: "var(--font-heading)",
                fontSize: 15,
                color: "var(--text)",
                lineHeight: 1.35,
                marginTop: 4,
                overflowWrap: "anywhere",
              }}
            >
              {b.from} ⇄ {b.to}
            </div>

            <div
              className="gl-cols"
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))",
                gap: "10px 16px",
                marginTop: 8,
              }}
            >
              <Side team={b.from} items={listOf(b.fromGives, b.fromGivesPicks)} />
              <Side team={b.to} items={listOf(b.toGives, b.toGivesPicks)} />
            </div>

            {/* Approve first, because the neutral outcome of this vote is that
                the trade goes through — a league that does nothing lets it
                stand, and the button order should not imply otherwise. */}
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button
                type="button"
                disabled={busy === b.id}
                onClick={() => void cast(b.id, "approve")}
                style={{
                  flex: 1,
                  minHeight: 40,
                  borderRadius: "var(--radius-sm)",
                  border: "1px solid rgb(var(--good-rgb) / .5)",
                  background: "rgb(var(--good-rgb) / .12)",
                  color: "var(--good)",
                  fontSize: 12.5,
                  letterSpacing: ".08em",
                  cursor: busy === b.id ? "default" : "pointer",
                }}
              >
                APPROVE
              </button>
              <button
                type="button"
                disabled={busy === b.id}
                onClick={() => void cast(b.id, "veto")}
                style={{
                  flex: 1,
                  minHeight: 40,
                  borderRadius: "var(--radius-sm)",
                  border: "1px solid rgb(var(--bad-rgb) / .5)",
                  background: "rgb(var(--bad-rgb) / .1)",
                  color: "var(--bad)",
                  fontSize: 12.5,
                  letterSpacing: ".08em",
                  cursor: busy === b.id ? "default" : "pointer",
                }}
              >
                VETO
              </button>
            </div>
          </div>
        );
      })}

      {failed ? (
        <div role="status" style={{ fontSize: 12, color: "var(--bad)", padding: "0 2px" }}>
          {failed}
        </div>
      ) : null}
    </div>
  );
}

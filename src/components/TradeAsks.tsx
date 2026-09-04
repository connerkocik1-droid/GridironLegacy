"use client";

import Link from "next/link";
import type { TradeAsk } from "@/lib/home-types";

/**
 * Somebody has offered you a trade.
 *
 * The trade desk has always held these, and nothing ever said so — an offer
 * sat there until the manager who received it happened to open the right page,
 * which in a league of twelve is how a deal dies of silence. It belongs here,
 * directly under the score, because a trade is the other thing that changes
 * what that score will be.
 *
 * The card says who and what, and no more. Accepting is a decision that wants
 * both rosters in front of you, so this leads to the desk rather than putting
 * an accept button under a list of names.
 */

const summary = (names: string[], picks: number): string => {
  const parts = [...names];
  if (picks) parts.push(picks === 1 ? "a pick" : `${picks} picks`);
  if (!parts.length) return "nothing";
  if (parts.length <= 2) return parts.join(" and ");
  return `${parts.slice(0, 2).join(", ")} and ${parts.length - 2} more`;
};

export default function TradeAsks({ trades }: { trades: TradeAsk[] }) {
  if (!trades.length) return null;

  return (
    <div style={{ display: "grid", gap: 8, margin: "14px 0 0" }}>
      {trades.map((t) => (
        <Link
          key={t.id}
          href="/trades"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            border: "1px solid rgba(224,181,115,.45)",
            borderRadius: "var(--radius-md)",
            background: "rgba(224,181,115,.08)",
            padding: "12px 14px",
            textDecoration: "none",
            color: "inherit",
            minHeight: 34,
          }}
        >
          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              style={{
                fontSize: 10,
                letterSpacing: ".2em",
                color: "#e0b573",
                marginBottom: 4,
              }}
            >
              {t.countered ? "COUNTER OFFER" : "TRADE OFFER"}
            </div>
            <div
              style={{
                fontFamily: "var(--font-heading)",
                fontSize: 15,
                color: "#e9e9ed",
                lineHeight: 1.35,
              }}
            >
              {t.from}
            </div>
            {/* Which way round each side goes, in a sentence rather than two
                columns: this is the notice, not the desk. */}
            <div
              style={{
                fontSize: 11.5,
                color: "#9397ab",
                lineHeight: 1.55,
                marginTop: 3,
                overflowWrap: "anywhere",
              }}
            >
              You get {summary(t.get, t.getPicks)} · you give {summary(t.give, t.givePicks)}
            </div>
          </div>
          <span aria-hidden style={{ color: "#e0b573", fontSize: 16, flex: "0 0 auto" }}>
            →
          </span>
        </Link>
      ))}
    </div>
  );
}

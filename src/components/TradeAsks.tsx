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

/**
 * Everything on one side of a deal, as a list.
 *
 * Picks come through as a count rather than by name, so they are one line
 * saying how many rather than a line each — the desk is where you find out
 * which ones.
 */
const itemsIn = (names: string[], picks: number): string[] => {
  const items = [...names];
  if (picks) items.push(picks === 1 ? "1 draft pick" : `${picks} draft picks`);
  return items;
};

/**
 * One half of the offer.
 *
 * A real list rather than divs made to look like one: a screen reader says
 * "list, three items" and reads them, which is exactly what the layout is
 * for. Nothing is truncated — an offer is worth reading in full, and a
 * summary that ends in "and 2 more" makes somebody open the desk to find out
 * whether it is a good deal, which is the question the card should answer.
 */
function Half({ label, items }: { label: string; items: string[] }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div
        style={{
          fontSize: 10,
          letterSpacing: ".16em",
          color: "#75798c",
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      {items.length === 0 ? (
        <div style={{ fontSize: 12, color: "#5a5d6e" }}>Nothing</div>
      ) : (
        <ul
          style={{
            listStyle: "none",
            margin: 0,
            padding: 0,
            display: "grid",
            gap: 3,
          }}
        >
          {items.map((item) => (
            <li
              key={item}
              style={{
                display: "flex",
                gap: 7,
                fontSize: 12.5,
                color: "#c8ccdc",
                lineHeight: 1.5,
              }}
            >
              <span aria-hidden style={{ color: "#e0b573", flex: "0 0 auto" }}>
                •
              </span>
              <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{item}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

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
            // Top, not centre. The card is as tall as the offer is long, and a
            // chevron centred against a six-item trade floats beside whichever
            // player happens to be in the middle of it.
            alignItems: "flex-start",
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
            {/* Both halves, itemised. A trade is a list of things on each
                side, and reading it as a sentence means counting commas to
                work out how many players are actually in it. */}
            <div
              className="gl-cols"
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))",
                gap: "10px 16px",
                marginTop: 8,
              }}
            >
              <Half label="YOU GET" items={itemsIn(t.get, t.getPicks)} />
              <Half label="YOU GIVE" items={itemsIn(t.give, t.givePicks)} />
            </div>
          </div>
          <span
            aria-hidden
            style={{ color: "#e0b573", fontSize: 16, flex: "0 0 auto", marginTop: 14 }}
          >
            →
          </span>
        </Link>
      ))}
    </div>
  );
}

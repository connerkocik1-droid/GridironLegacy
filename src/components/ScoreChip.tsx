"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import TeamCrest from "./TeamCrest";
import { useLogos } from "@/lib/use-logos";
import { useRefreshable } from "@/lib/use-refresh";
import { blip } from "@/lib/retro";
import { ink } from "./RowList";

interface Side {
  id: string;
  slot?: string;
  franchise: string;
  total: number;
}

interface Mine {
  live: boolean;
  me: Side;
  opp: Side;
}

/**
 * Your game, always in the header: both crests and both live scores. Tapping
 * it opens Matchup. From the header of prototype/Pylon App.dc.html.
 *
 * Renders nothing for a bye week, before anybody is signed in, or when the
 * league has no matchup to show — the header simply closes up around it.
 */
export default function ScoreChip() {
  const logos = useLogos();
  const [mine, setMine] = useState<Mine | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/matchup", { cache: "no-store" });
      if (!res.ok) return;
      const body = await res.json();
      if (!body?.home || !body?.away || !body.mine) return setMine(null);
      setMine({ live: !!body.live, me: body.home, opp: body.away });
    } catch {
      // The chip is a shortcut; the matchup page says what went wrong.
    }
  }, []);

  useRefreshable(load);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    const timer = setInterval(() => void load(), 60_000);
    return () => clearInterval(timer);
  }, [load]);

  if (!mine) return null;
  const { me, opp } = mine;
  const lead = me.total >= opp.total;
  const crest = (s: Side) => (
    <TeamCrest franchise={s.franchise} logo={logos[s.id] ?? (s.slot ? logos[s.slot] : undefined) ?? null} size={20} shape="box" />
  );
  const pts = (on: boolean): React.CSSProperties => ({
    fontSize: 13,
    fontWeight: 500,
    fontStyle: "italic",
    fontVariantNumeric: "tabular-nums",
    color: on ? "var(--ap-a100)" : "var(--ap-n300)",
  });

  return (
    <Link
      href="/lineup"
      onClick={blip}
      className="gl-score gl-press"
      aria-label={`${me.franchise} ${me.total.toFixed(1)}, ${opp.franchise} ${opp.total.toFixed(1)}. Open matchup.`}
      style={{
        flex: "0 0 auto",
        marginLeft: "auto",
        display: "flex",
        alignItems: "center",
        gap: 7,
        padding: "5px 8px",
        minHeight: 32,
        borderRadius: 4,
        border: `1px solid ${ink(10)}`,
        background: ink(4),
        color: "var(--text)",
        textDecoration: "none",
      }}
    >
      {mine.live ? (
        <span
          aria-hidden
          className="gl-pulse"
          style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--ap-a300)", boxShadow: "0 0 8px var(--ap-accent)" }}
        />
      ) : null}
      {crest(me)}
      <span style={pts(lead)}>{me.total.toFixed(1)}</span>
      <span aria-hidden style={{ fontSize: 9, color: "var(--ap-n600)" }}>
        –
      </span>
      <span style={pts(!lead)}>{opp.total.toFixed(1)}</span>
      {crest(opp)}
    </Link>
  );
}

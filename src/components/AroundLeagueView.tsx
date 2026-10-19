"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useLogos } from "@/lib/use-logos";
import { useRefreshable } from "@/lib/use-refresh";
import TeamCrest from "./TeamCrest";
import { AppView, GroupLabel, GroupSkeleton, Note, RowGroup, ink, tint, type RowSpec } from "./RowList";

interface Side {
  id: string;
  slot: string;
  name: string;
  franchise: string;
  points: number | null;
  projected?: number | null;
  record: { w: number; l: number; t: number };
}

interface Schedule {
  meId: string;
  weeks: number[];
  liveWeek: number | null;
  games: { week: number; final: boolean; home: Side; away: Side }[];
}

/**
 * The League → Around League: every game this week as one even card — logo
 * and name, points, VS, points, name and logo — with a bar of each side's
 * share of the points. Your game is pinned first and tinted. Sized so a
 * ten-team week fits one phone screen. Tapping a card opens it on Matchup.
 * From the Around League view in prototype/Pylon App.dc.html.
 */
export default function AroundLeagueView() {
  const logos = useLogos();
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/schedule", { cache: "no-store" });
      if (res.status === 401) return setError("Sign in to see the league.");
      if (!res.ok) throw new Error(String(res.status));
      setSchedule(await res.json());
      setError(null);
    } catch {
      setError("Could not read this week's games.");
    }
  }, []);

  useRefreshable(load);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    const t = setInterval(() => void load(), 60_000);
    return () => clearInterval(t);
  }, [load]);

  if (error && !schedule) {
    return (
      <AppView>
        <Note tag="LEAGUE" tone="warn">{error}</Note>
      </AppView>
    );
  }
  if (!schedule) {
    return (
      <AppView>
        <GroupSkeleton rows={5} />
      </AppView>
    );
  }

  // This week: the live one, or the last one played once the season is over.
  const week = schedule.liveWeek ?? schedule.weeks[schedule.weeks.length - 1] ?? null;
  const me = schedule.meId;
  const games = schedule.games
    .filter((g) => g.week === week)
    .sort((x, y) => Number(y.home.id === me || y.away.id === me) - Number(x.home.id === me || x.away.id === me));

  if (week == null || !games.length) {
    return (
      <AppView>
        <Note tag="LEAGUE">No games scheduled yet. They appear here once the commissioner draws the season.</Note>
        <RowGroup label="MORE FROM THE LEAGUE" rows={MORE} />
      </AppView>
    );
  }

  const pts = (lead: boolean, right: boolean): React.CSSProperties => ({
    fontSize: 26,
    fontWeight: 300,
    fontStyle: "italic",
    letterSpacing: "-.05em",
    lineHeight: 1,
    minWidth: 64,
    textAlign: right ? "right" : "left",
    fontVariantNumeric: "tabular-nums",
    color: lead ? "var(--ap-a100)" : "var(--ap-n400)",
    textShadow: lead ? `0 0 18px ${tint(45)}` : undefined,
  });
  const owner = (s: Side) =>
    `${s.name.split(" ")[0]} · ${s.record.w}-${s.record.l}${s.record.t ? `-${s.record.t}` : ""}`;
  const crest = (s: Side) => (
    <TeamCrest franchise={s.franchise} logo={logos[s.id] ?? logos[s.slot] ?? null} size={34} shape="box" />
  );
  const name: React.CSSProperties = {
    fontSize: 12.5,
    fontWeight: 500,
    lineHeight: 1.2,
    overflow: "hidden",
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
  };

  return (
    <AppView>
      <GroupLabel label={`WEEK ${week}`} note={`${games.length} game${games.length === 1 ? "" : "s"}`} />
      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        {games.map((g) => {
          const a = g.home;
          const b = g.away;
          const la = a.points ?? 0;
          const lb = b.points ?? 0;
          const mine = a.id === me || b.id === me;
          const played = a.points != null || b.points != null;
          return (
            <Link
              key={`${a.id}:${b.id}`}
              href={mine ? "/lineup" : `/lineup?home=${encodeURIComponent(a.id)}&week=${g.week}`}
              className="gl-press"
              aria-label={`${a.franchise} ${la.toFixed(1)}, ${b.franchise} ${lb.toFixed(1)}. Open matchup.`}
              style={{
                display: "block",
                textDecoration: "none",
                color: "var(--text)",
                padding: "11px 12px",
                borderRadius: 6,
                border: `1px solid ${mine ? tint(40) : ink(8)}`,
                background: mine ? `linear-gradient(160deg,${tint(16)},${ink(2)})` : ink(3),
                backdropFilter: "blur(18px)",
                WebkitBackdropFilter: "blur(18px)",
                boxShadow: `inset 0 1px 0 ${ink(mine ? 12 : 7)}`,
                ["--gl-panel" as string]: 1,
              }}
            >
              <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto minmax(0,1fr)", alignItems: "center", gap: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                  {crest(a)}
                  <div style={{ minWidth: 0 }}>
                    <div style={name}>{a.franchise}</div>
                    <div style={{ fontSize: 10, color: "var(--ap-n500)", marginTop: 3, whiteSpace: "nowrap" }}>{owner(a)}</div>
                  </div>
                </div>
                <span style={{ fontSize: 10, letterSpacing: ".16em", color: "var(--ap-n600)" }}>VS</span>
                <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, justifyContent: "flex-end" }}>
                  <div style={{ minWidth: 0, textAlign: "right" }}>
                    <div style={name}>{b.franchise}</div>
                    <div style={{ fontSize: 10, color: "var(--ap-n500)", marginTop: 3, whiteSpace: "nowrap" }}>{owner(b)}</div>
                  </div>
                  {crest(b)}
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "auto minmax(0,1fr) auto", alignItems: "center", gap: 10, marginTop: 9 }}>
                <span style={pts(played && la >= lb, false)}>{la.toFixed(1)}</span>
                <div style={{ height: 3, borderRadius: 2, background: ink(9), overflow: "hidden", display: "flex" }}>
                  <div
                    style={{
                      height: "100%",
                      transition: "width .8s ease",
                      background: "linear-gradient(90deg,var(--ap-a600),var(--ap-a200))",
                      width: `${((la / (la + lb || 1)) * 100 || (played ? 0 : 50)).toFixed(1)}%`,
                    }}
                  />
                </div>
                <span style={pts(played && lb > la, true)}>{lb.toFixed(1)}</span>
              </div>
            </Link>
          );
        })}
      </div>
      <div style={{ marginTop: 12 }}>
        <RowGroup label="MORE FROM THE LEAGUE" rows={MORE} />
      </div>
    </AppView>
  );
}

// Not in the design, which has no chat or news; kept so the redesign does
// not leave either of them unreachable.
const MORE: RowSpec[] = [
  { key: "chat", tile: "CHAT", title: "League chat", sub: "Talk to the rest of the league", href: "/chat" },
  { key: "news", tile: "NEWS", title: "News", sub: "Injuries and moves around the NFL", href: "/news" },
  { key: "rules", tile: "RULES", title: "League rules", sub: "Roster, scoring and waivers", href: "/rules" },
];

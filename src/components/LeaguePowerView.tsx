"use client";

import { useCallback, useEffect, useState } from "react";
import type { Home } from "@/lib/home-types";
import { useLogos } from "@/lib/use-logos";
import { useRefreshable } from "@/lib/use-refresh";
import TeamCrest from "./TeamCrest";
import { AppView, GroupSkeleton, Note, RowGroup, type Movement } from "./RowList";

/**
 * Rankings → League Power: every franchise by power score, the top three lit,
 * with how far each has moved since the last graded week. From the League
 * Power view in prototype/Pylon App.dc.html — less its four-week trails, which
 * the prototype drew from made-up history and the league does not keep.
 */
export default function LeaguePowerView() {
  const logos = useLogos();
  const [home, setHome] = useState<Home | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/home", { cache: "no-store" });
      if (res.status === 401) return setError("Sign in to see your league.");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        return setError(body.error ?? "Could not read the league.");
      }
      setHome(await res.json());
      setError(null);
    } catch {
      setError("Could not read the league.");
    }
  }, []);

  useRefreshable(load);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  if (error && !home) {
    return (
      <AppView>
        <Note tag="POWER" tone="warn">{error}</Note>
      </AppView>
    );
  }
  if (!home) {
    return (
      <AppView>
        <GroupSkeleton rows={10} />
      </AppView>
    );
  }
  if (!home.played) {
    return (
      <AppView>
        <Note tag={`WEEK ${home.week ?? ""}`.trim()}>Power rankings start once a week has been settled.</Note>
      </AppView>
    );
  }

  const chg = (m: number | null): Movement =>
    m == null || m === 0 ? { tone: "flat", label: "—" } : { tone: m > 0 ? "up" : "down", label: `${m > 0 ? "▲" : "▼"}${Math.abs(m)}` };

  return (
    <AppView>
      <RowGroup
        label={`WEEK ${home.week ?? ""}`.trim()}
        note="power score"
        rows={home.power.map((t, i) => ({
          key: t.id,
          num: t.rank,
          lit: i < 3,
          chg: chg(t.movement),
          hi: t.mine,
          logo: <TeamCrest franchise={t.franchise} logo={logos[t.id] ?? logos[t.slot] ?? null} size={26} shape="box" />,
          title: t.franchise,
          sub: [
            t.name.split(" ")[0],
            `${t.wins}-${t.losses}${t.ties ? `-${t.ties}` : ""}`,
            `${Math.round(t.pointsFor)} PF`,
            t.avgAge != null ? `avg age ${t.avgAge.toFixed(1)}` : null,
          ]
            .filter(Boolean)
            .join(" · "),
          val: Math.round(t.rating).toString(),
          bigVal: true,
          valColor: "var(--ap-a200)",
          href: `/team/${t.id}`,
        }))}
      />
    </AppView>
  );
}

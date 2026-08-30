"use client";

import { useCallback, useEffect, useState } from "react";

interface Manager {
  id: string;
  slot: string;
  name: string;
  franchise: string;
  division: string | null;
  claimed: boolean;
  isCommissioner: boolean;
}

interface Admin {
  isCommissioner: boolean;
  league: {
    id: string;
    name: string;
    season: number;
    settings: { rounds?: number; pickSeconds?: number };
    draft_state: string;
    current_pick: number;
  } | null;
  managers: Manager[];
  board: { picks: number; made: number };
  canResize: boolean;
}

const card: React.CSSProperties = {
  border: "1px solid rgba(145,132,217,.22)",
  borderRadius: "var(--radius-lg)",
  background: "rgba(26,28,43,.55)",
  padding: "16px 18px",
  marginBottom: 16,
};

const numberField: React.CSSProperties = {
  width: 78,
  padding: "8px 10px",
  background: "rgba(20,22,35,.8)",
  border: "1px solid rgba(145,132,217,.3)",
  borderRadius: "var(--radius-sm)",
  color: "#e9e9ed",
  font: "inherit",
  fontSize: 14,
};

const action = (enabled: boolean): React.CSSProperties => ({
  padding: "8px 14px",
  border: "1px solid rgba(181,171,252,.6)",
  background: "transparent",
  color: "#d2cefd",
  borderRadius: "var(--radius-sm)",
  font: "inherit",
  fontSize: 12,
  letterSpacing: ".1em",
  textTransform: "uppercase",
  cursor: enabled ? "pointer" : "default",
  opacity: enabled ? 1 : 0.45,
});

export default function Commissioner() {
  const [admin, setAdmin] = useState<Admin | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [teams, setTeams] = useState("");
  const [rounds, setRounds] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/league", { cache: "no-store" });
      if (res.status === 401) return setError("Sign in as the commissioner.");
      if (res.status === 503) {
        const body = await res.json().catch(() => ({}));
        return setError(body.error ?? "The league database is not configured yet.");
      }
      if (!res.ok) throw new Error(String(res.status));

      const data: Admin = await res.json();
      setAdmin(data);
      setTeams(String(data.managers.length));
      setRounds(String(data.league?.settings?.rounds ?? 24));
      setError(null);
    } catch {
      setError("Could not load the league office.");
    }
  }, []);

  useEffect(() => {
    // Sets state only once the request resolves, not synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function save() {
    if (busy || !admin) return;
    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      const res = await fetch("/api/admin/league", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ teams: Number(teams), rounds: Number(rounds) }),
      });
      const body = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(body.error ?? "That change did not go through.");
      } else {
        setNotice("Saved. The draft board has been rebuilt to match.");
      }
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function buildSchedule() {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      const res = await fetch("/api/admin/schedule", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) setError(body.error ?? "Could not build the schedule.");
      else
        setNotice(
          `Schedule built: ${body.matchups} matchups over ${body.weeks} weeks` +
            (body.byes ? `, with ${body.byes} byes.` : "."),
        );
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function moveDivision(manager: Manager, division: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      const res = await fetch("/api/admin/divisions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ managerId: manager.id, division }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) setError(body.error ?? "Could not move that franchise.");
      else setNotice(`${manager.franchise} is in the ${division}. Rebuild the schedule to apply it.`);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function clearPin(manager: Manager) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      const res = await fetch("/api/admin/reset-pin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ managerId: manager.id }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) setError(body.error ?? "Could not clear that PIN.");
      else setNotice(`${manager.franchise} can claim a new PIN at sign-in.`);
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (error && !admin) {
    return <div style={{ padding: "24px 26px", color: "#e0b573" }}>{error}</div>;
  }
  if (!admin) {
    return <div style={{ padding: "24px 26px", color: "#75798c" }}>Opening the league office…</div>;
  }
  if (!admin.isCommissioner) {
    return (
      <div style={{ padding: "24px 26px", color: "#9397ab" }}>
        The league office is the commissioner&apos;s.
      </div>
    );
  }

  const claimed = admin.managers.filter((m) => m.claimed).length;

  // The two divisions actually in use, so a renamed pair still shows.
  const divisions = Array.from(
    new Set(admin.managers.map((m) => m.division).filter(Boolean) as string[]),
  ).sort();
  if (divisions.length < 2) divisions.push(...["East", "West"].filter((d) => !divisions.includes(d)));

  // Everyone once, then the divisional rematches: (n-1) + (largest division - 1).
  const perDivision = divisions.map(
    (d) => admin.managers.filter((m) => m.division === d).length,
  );
  const n = admin.managers.length;
  const seasonWeeks =
    (n % 2 === 1 ? n : n - 1) + Math.max(0, Math.max(...perDivision, 0) - 1);
  const changed =
    Number(teams) !== admin.managers.length ||
    Number(rounds) !== (admin.league?.settings?.rounds ?? 24);

  return (
    <div style={{ padding: "24px 26px 40px", maxWidth: 780 }}>
      <div style={{ fontSize: 9, letterSpacing: ".32em", color: "#75798c" }}>LEAGUE OFFICE</div>
      <h1
        style={{
          fontFamily: "var(--font-heading)",
          fontSize: 40,
          letterSpacing: "-.035em",
          margin: "8px 0 20px",
          fontWeight: 500,
        }}
      >
        {admin.league?.name ?? "League"}
      </h1>

      {notice ? (
        <div style={{ fontSize: 12, color: "#7fd1a8", marginBottom: 14 }}>{notice}</div>
      ) : null}
      {error ? (
        <div style={{ fontSize: 12, color: "#e0b573", marginBottom: 14 }}>{error}</div>
      ) : null}

      <div style={card}>
        <h6 style={{ margin: "0 0 4px", color: "#d2cefd" }}>League size</h6>
        <p style={{ fontSize: 12, color: "#9397ab", lineHeight: 1.6, margin: "0 0 14px" }}>
          {claimed} of {admin.managers.length} franchises claimed. Adding creates
          open franchises for people to claim; removing only ever takes away ones
          nobody has claimed and that hold no players. The draft board is rebuilt
          from these numbers, so it always matches the league.
        </p>

        <div style={{ display: "flex", gap: 20, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div>
            <label htmlFor="teams" style={{ display: "block", fontSize: 10, letterSpacing: ".2em", color: "#75798c", marginBottom: 6 }}>
              FRANCHISES
            </label>
            <input
              id="teams"
              value={teams}
              onChange={(e) => setTeams(e.target.value.replace(/\D/g, "").slice(0, 2))}
              inputMode="numeric"
              disabled={!admin.canResize}
              style={{ ...numberField, opacity: admin.canResize ? 1 : 0.5 }}
            />
          </div>

          <div>
            <label htmlFor="rounds" style={{ display: "block", fontSize: 10, letterSpacing: ".2em", color: "#75798c", marginBottom: 6 }}>
              ROUNDS
            </label>
            <input
              id="rounds"
              value={rounds}
              onChange={(e) => setRounds(e.target.value.replace(/\D/g, "").slice(0, 2))}
              inputMode="numeric"
              disabled={!admin.canResize}
              style={{ ...numberField, opacity: admin.canResize ? 1 : 0.5 }}
            />
          </div>

          <button onClick={save} disabled={busy || !changed || !admin.canResize} style={action(!busy && changed && admin.canResize)}>
            Save &amp; rebuild board
          </button>
        </div>

        <div style={{ fontSize: 11, color: "#75798c", marginTop: 12 }}>
          {admin.canResize
            ? `Board: ${admin.board.picks} picks.`
            : `The draft has started — ${admin.board.made} picks are in, so the size is fixed now.`}
        </div>
      </div>

      <div style={card}>
        <h6 style={{ margin: "0 0 4px", color: "#d2cefd" }}>Season schedule</h6>
        <p style={{ fontSize: 12, color: "#9397ab", lineHeight: 1.6, margin: "0 0 10px" }}>
          Everyone plays everyone once, then divisional rivals meet a second
          time. That decides the season length rather than the other way round:
          {" "}
          <strong style={{ color: "#d2cefd", fontWeight: 500 }}>
            {seasonWeeks} weeks
          </strong>{" "}
          for {admin.managers.length} franchises. Build it once the divisions
          are settled — it cannot be rebuilt after a week has been played,
          because that would discard results that already stand.
        </p>
        <p style={{ fontSize: 11.5, color: "#75798c", lineHeight: 1.6, margin: "0 0 14px" }}>
          {seasonWeeks > 15
            ? "That is longer than an NFL regular season leaves room for once you add playoffs — consider fewer franchises, or divisional rivals once."
            : "That leaves room for playoffs inside an 18-week NFL season."}
        </p>
        <button onClick={buildSchedule} disabled={busy} style={action(!busy)}>
          Build schedule
        </button>
      </div>

      <div style={card}>
        <h6 style={{ margin: "0 0 4px", color: "#d2cefd" }}>Franchises and divisions</h6>
        <p style={{ fontSize: 12, color: "#9397ab", lineHeight: 1.6, margin: "0 0 10px" }}>
          {divisions.join(" and ")} — {perDivision.join(" and ")} franchises.
          Moving a franchise takes effect when you rebuild the schedule, and is
          refused once a week has been played. Clearing a PIN does not set a new one — the manager chooses theirs at
          sign-in, so nobody can sign in as their team.
        </p>

        {admin.managers.map((m) => (
          <div
            key={m.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "9px 0",
              borderTop: "1px solid rgba(145,132,217,.12)",
            }}
          >
            <span style={{ fontSize: 10, color: "#75798c", width: 44, flex: "0 0 auto" }}>
              {m.slot}
            </span>
            <span style={{ fontFamily: "var(--font-heading)", fontSize: 14, minWidth: 0, flex: 1 }}>
              {m.franchise}
              {m.isCommissioner ? (
                <span style={{ fontSize: 9, letterSpacing: ".14em", color: "#b5abfc", marginLeft: 8 }}>
                  COMMISSIONER
                </span>
              ) : null}
            </span>
            <div style={{ display: "flex", gap: 3, flex: "0 0 auto" }}>
              {divisions.map((d) => (
                <button
                  key={d}
                  onClick={() => moveDivision(m, d)}
                  disabled={busy || m.division === d}
                  style={{
                    padding: "3px 8px",
                    fontSize: 9,
                    letterSpacing: ".12em",
                    border: `1px solid ${m.division === d ? "rgba(181,171,252,.6)" : "rgba(145,132,217,.22)"}`,
                    background: m.division === d ? "rgba(145,132,217,.26)" : "transparent",
                    color: m.division === d ? "#e9e9ed" : "#75798c",
                    borderRadius: "var(--radius-sm)",
                    font: "inherit",
                    cursor: busy || m.division === d ? "default" : "pointer",
                  }}
                >
                  {d.toUpperCase()}
                </button>
              ))}
            </div>

            <span
              style={{
                fontSize: 9,
                letterSpacing: ".14em",
                padding: "2px 7px",
                borderRadius: 2,
                flex: "0 0 auto",
                border: `1px solid ${m.claimed ? "rgba(127,209,168,.5)" : "rgba(145,132,217,.35)"}`,
                color: m.claimed ? "#7fd1a8" : "#9397ab",
              }}
            >
              {m.claimed ? m.name : "OPEN"}
            </span>
            {m.claimed ? (
              <button onClick={() => clearPin(m)} disabled={busy} style={{ ...action(!busy), padding: "5px 10px", fontSize: 10 }}>
                Clear PIN
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

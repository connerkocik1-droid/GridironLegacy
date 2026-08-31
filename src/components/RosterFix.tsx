"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

interface Player {
  name: string;
  managerId: string;
  franchise: string;
  slot: string;
}

interface Feed {
  managers: { id: string; franchise: string; slot: string }[];
  players: Player[];
}

const field: React.CSSProperties = {
  padding: "7px 9px",
  background: "rgba(20,22,35,.8)",
  border: "1px solid rgba(145,132,217,.28)",
  borderRadius: "var(--radius-sm)",
  color: "#e9e9ed",
  font: "inherit",
  fontSize: 12.5,
};

const button = (enabled: boolean): React.CSSProperties => ({
  padding: "8px 14px",
  fontSize: 10,
  letterSpacing: ".14em",
  textTransform: "uppercase",
  border: `1px solid ${enabled ? "rgba(181,171,252,.6)" : "rgba(145,132,217,.2)"}`,
  background: "transparent",
  color: enabled ? "#d2cefd" : "#5a5d6e",
  borderRadius: "var(--radius-sm)",
  font: "inherit",
  cursor: enabled ? "pointer" : "default",
});

/**
 * Putting a player where he should have been.
 *
 * The last resort, and deliberately a little slow to use: you search for the
 * player, choose where he goes, and say why. The reason is not decoration —
 * it lands in the league's own move list, where everybody can read it. A
 * commissioner who can move players quietly is the thing this is designed not
 * to be.
 */
export default function RosterFix() {
  const [feed, setFeed] = useState<Feed | null>(null);
  const [search, setSearch] = useState("");
  const [chosen, setChosen] = useState<Player | null>(null);
  const [to, setTo] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/roster", { cache: "no-store" });
      if (!res.ok) return;
      setFeed(await res.json());
    } catch {
      setError("Could not read the rosters.");
    }
  }, []);

  useEffect(() => {
    // Sets state only once the request resolves, not synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  // Ten at a time: this is a search box, not a list of two hundred names.
  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!feed || q.length < 2) return [];
    return feed.players.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 10);
  }, [feed, search]);

  async function move(release: boolean) {
    if (busy || !chosen) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/roster", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          player: chosen.name,
          to: release ? null : to,
          reason: reason || null,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "That did not go through.");
      } else {
        setNotice(
          release
            ? `${chosen.name} was released from ${body.from} and is on waivers.`
            : `${chosen.name} moved from ${body.from} to ${body.to}.`,
        );
        setChosen(null);
        setSearch("");
        setReason("");
        setTo("");
      }
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h6 style={{ margin: "0 0 4px", color: "#d2cefd" }}>Fix a roster</h6>
      <p style={{ fontSize: 11.5, color: "#9397ab", margin: "0 0 12px", lineHeight: 1.6 }}>
        For an honest mistake: a player autodrafted to the wrong franchise, a drop somebody made by
        accident. Every correction appears in the league&apos;s moves with your reason attached, so
        nobody has to take your word for what happened.
      </p>

      {notice ? (
        <div style={{ fontSize: 12, color: "#7fd1a8", marginBottom: 10 }}>{notice}</div>
      ) : null}
      {error ? <div style={{ fontSize: 12, color: "#e0b573", marginBottom: 10 }}>{error}</div> : null}

      {chosen ? (
        <div
          style={{
            border: "1px solid rgba(145,132,217,.28)",
            borderRadius: "var(--radius-md)",
            padding: "12px 14px",
          }}
        >
          <div style={{ fontSize: 13, marginBottom: 10 }}>
            <span style={{ fontFamily: "var(--font-heading)", fontSize: 15 }}>{chosen.name}</span>
            <span style={{ color: "#75798c" }}> — held by {chosen.franchise}</span>
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
            <div>
              <label
                htmlFor="moveTo"
                style={{
                  display: "block",
                  fontSize: 10,
                  letterSpacing: ".18em",
                  color: "#75798c",
                  marginBottom: 5,
                }}
              >
                MOVE TO
              </label>
              <select
                id="moveTo"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                style={{ ...field, minWidth: 170 }}
              >
                <option value="">Choose a franchise…</option>
                {(feed?.managers ?? [])
                  .filter((m) => m.id !== chosen.managerId)
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.franchise}
                    </option>
                  ))}
              </select>
            </div>

            <div style={{ flex: 1, minWidth: 180 }}>
              <label
                htmlFor="moveReason"
                style={{
                  display: "block",
                  fontSize: 10,
                  letterSpacing: ".18em",
                  color: "#75798c",
                  marginBottom: 5,
                }}
              >
                WHY
              </label>
              <input
                id="moveReason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="autodrafted to the wrong team"
                style={{ ...field, width: "100%" }}
              />
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
            <button onClick={() => void move(false)} disabled={busy || !to} style={button(!busy && !!to)}>
              Move him
            </button>
            <button
              onClick={() => void move(true)}
              disabled={busy}
              style={{ ...button(!busy), borderColor: "rgba(224,181,115,.5)", color: "#e0b573" }}
            >
              Release to waivers
            </button>
            <button
              onClick={() => setChosen(null)}
              style={{ ...button(true), borderColor: "rgba(145,132,217,.24)", color: "#9397ab" }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search a rostered player"
            aria-label="Search a rostered player"
            style={{ ...field, width: "100%", maxWidth: 320 }}
          />
          {matches.length ? (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
              {matches.map((p) => (
                <button
                  key={p.name}
                  onClick={() => {
                    setChosen(p);
                    setNotice(null);
                    setError(null);
                  }}
                  style={{ ...button(true), textTransform: "none", fontSize: 11.5 }}
                >
                  {p.name}
                  <span style={{ color: "#75798c" }}> · {p.franchise}</span>
                </button>
              ))}
            </div>
          ) : search.trim().length >= 2 ? (
            <div style={{ fontSize: 11.5, color: "#75798c", marginTop: 10 }}>
              Nobody on a roster by that name. A free agent has to be added by his own franchise.
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

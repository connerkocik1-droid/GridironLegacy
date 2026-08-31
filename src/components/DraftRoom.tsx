"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { headshot, logo } from "@/data/league-data";
import DraftBoard from "./DraftBoard";
import DraftCountdown from "./DraftCountdown";
import DraftReveal, { type RevealPick } from "./DraftReveal";
import DraftTicker from "./DraftTicker";
import ResetDraft from "./ResetDraft";

const BLANK =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

interface Pick {
  overall: number;
  round: number;
  manager_id: string | null;
  player_name: string | null;
  picked_at: string | null;
}

interface Available {
  name: string;
  position: string;
  team: string;
  adp: number;
  posRank: string;
  bye: number;
}

interface Board {
  me: { id: string; slot: string; franchise: string; is_commissioner: boolean; ready: boolean };
  league: {
    state: "pending" | "running" | "paused" | "complete";
    currentPick: number;
    pickStartedAt: string | null;
    pickSeconds: number;
    serverNow: string;
    draftAt: string | null;
    cinematicRounds: number;
    introVideo: string | null;
  };
  onTheClock: Pick | null;
  myTurn: boolean;
  picks: Pick[];
  managers: { id: string; slot: string; franchise: string; ready?: boolean }[];
  available: Available[];
}

const POSITIONS = ["ALL", "QB", "RB", "WR", "TE", "K", "D/ST"];

export default function DraftRoom() {
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("ALL");
  const [search, setSearch] = useState("");
  const [picking, setPicking] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [reveal, setReveal] = useState<RevealPick | null>(null);
  // The board is the reference view; the player list is where you pick from.
  const [view, setView] = useState<"players" | "board">("players");

  // The chime, and whether the browser has let us play it yet. Autoplay is
  // blocked until the page has been interacted with, so it is primed silently
  // on the first click anywhere — by the time a pick lands it is unblocked.
  const chime = useRef<HTMLAudioElement | null>(null);
  const primed = useRef(false);
  // What the board looked like last time, so a new pick can be spotted.
  const seen = useRef<Set<number> | null>(null);

  // The offset between this browser's clock and the server's, measured on
  // every refresh. The countdown is drawn through it, so a manager whose
  // machine is minutes off still sees the same time as everyone else.
  const [skew, setSkew] = useState(0);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/draft", { cache: "no-store" });
      if (res.status === 401) return setError("Sign in to enter the draft room.");
      if (res.status === 503) {
        const body = await res.json().catch(() => ({}));
        return setError(body.error ?? "The league database is not configured yet.");
      }
      if (!res.ok) throw new Error(String(res.status));

      const data: Board = await res.json();
      setSkew(new Date(data.league.serverNow).getTime() - Date.now());
      setBoard(data);
      setError(null);
    } catch {
      setError("Could not load the draft board.");
    }
  }, []);

  useEffect(() => {
    // Sets state only once the request resolves, not synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    const timer = setInterval(() => void load(), 5_000);
    return () => clearInterval(timer);
  }, [load]);

  // Unblock the chime on the first interaction anywhere: play it muted, stop
  // it, and it is allowed to sound for real later.
  useEffect(() => {
    const prime = () => {
      const audio = chime.current;
      if (!audio || primed.current) return;
      primed.current = true;
      audio.volume = 0;
      audio
        .play()
        .then(() => {
          audio.pause();
          audio.currentTime = 0;
          audio.volume = 0.85;
        })
        .catch(() => {
          audio.volume = 0.85;
        });
    };

    window.addEventListener("pointerdown", prime, { once: true });
    window.addEventListener("keydown", prime, { once: true });
    return () => {
      window.removeEventListener("pointerdown", prime);
      window.removeEventListener("keydown", prime);
    };
  }, []);

  // The clock only advances local time; the countdown itself is derived below
  // from the server's pick_started_at, never from a timer that started when
  // this page happened to open.
  const running = board?.league.state === "running" && Boolean(board.league.pickStartedAt);

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [running]);

  const remaining = running && board?.league.pickStartedAt
    ? Math.max(
        0,
        Math.ceil(
          (new Date(board.league.pickStartedAt).getTime() +
            board.league.pickSeconds * 1000 -
            (now + skew)) /
            1000,
        ),
      )
    : 0;

  const managerName = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of board?.managers ?? []) map.set(m.id, m.franchise);
    return map;
  }, [board]);

  // A pick landing is what triggers the reveal. The board is polled, so a new
  // pick is one this browser has not seen before — on the first load every
  // pick is "new", which would fire a reveal for the whole board, so the first
  // sighting only records what is already there.
  useEffect(() => {
    if (!board) return;

    const made = board.picks.filter((p) => p.player_name);
    const ids = new Set(made.map((p) => p.overall));

    if (seen.current === null) {
      seen.current = ids;
      return;
    }

    const fresh = made
      .filter((p) => !seen.current!.has(p.overall))
      .sort((a, b) => a.overall - b.overall);

    seen.current = ids;
    if (!fresh.length) return;

    // Several picks can land between two polls; the latest is the one worth
    // watching, and the rest are already in the board's history.
    const latest = fresh[fresh.length - 1];
    if (latest.round > board.league.cinematicRounds) return;

    const audio = chime.current;
    if (audio) {
      audio.currentTime = 0;
      // A blocked chime is not worth failing the reveal over.
      audio.play().catch(() => {});
    }

    setReveal({
      playerName: latest.player_name!,
      franchise: managerName.get(latest.manager_id ?? "") ?? "—",
      slot: "",
      overall: latest.overall,
      round: latest.round,
      mine: latest.manager_id === board.me.id,
    });
  }, [board, managerName]);

  const visible = useMemo(() => {
    if (!board) return [];
    const q = search.trim().toLowerCase();
    return board.available.filter((p) => {
      if (filter !== "ALL" && p.position !== filter) return false;
      if (q && !p.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [board, filter, search]);

  async function setDraftState(state: "running" | "paused") {
    if (picking) return;
    setPicking("__state__");
    try {
      const res = await fetch("/api/admin/draft", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ state }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) setError(body.error ?? "That did not go through.");
      else setError(null);
      await load();
    } finally {
      setPicking(null);
    }
  }

  async function markReady() {
    if (picking) return;
    setPicking("__ready__");
    try {
      const res = await fetch("/api/draft/ready", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ready: true }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Could not mark you ready.");
      } else {
        setError(null);
      }
      await load();
    } finally {
      setPicking(null);
    }
  }

  async function resetDraft() {
    if (picking) return;
    setPicking("__reset__");
    try {
      const res = await fetch("/api/admin/draft/reset", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) setError(body.error ?? "The draft was not reset.");
      else setError(null);
      // A reset empties the board, so the "new pick" tracker is emptied with
      // it — otherwise the re-drafted pick 1 is an overall this browser has
      // already seen, and its reveal never fires. An empty set rather than
      // null, so the next pick counts as new instead of only being recorded.
      seen.current = new Set();
      setReveal(null);
      await load();
    } finally {
      setPicking(null);
    }
  }

  async function pick(name: string) {
    if (!board?.myTurn || picking) return;
    setPicking(name);
    try {
      const res = await fetch("/api/draft", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ player: name }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) setError(body.error ?? "That pick did not go through.");
      else setError(null);
      await load();
    } finally {
      setPicking(null);
    }
  }

  if (error && !board) {
    return <div style={{ padding: "24px 26px", color: "#e0b573" }}>{error}</div>;
  }
  if (!board) {
    return <div style={{ padding: "24px 26px", color: "#75798c" }}>Opening the draft room…</div>;
  }

  const recent = board.picks.filter((p) => p.player_name).slice(-12).reverse();
  const picksMade = board.picks.filter((p) => p.player_name).length;
  const urgent = remaining <= 15 && board.league.state === "running";

  // Nothing to show a board for until the draft is open.
  if (board.league.state === "pending" || board.league.state === "paused") {
    return (
      <>
        <audio ref={chime} src="/assets/nfl-draft-chime.mp3" preload="auto" />
        {error ? (
          <div style={{ padding: "0 26px", fontSize: 12, color: "#e0b573" }}>{error}</div>
        ) : null}
        <DraftCountdown
          draftAt={board.league.draftAt}
          skew={skew}
          state={board.league.state}
          isCommissioner={board.me.is_commissioner}
          managers={board.managers}
          onStart={() => void setDraftState("running")}
          busy={picking != null}
          introVideo={board.league.introVideo}
          meReady={board.me.ready}
          onReady={markReady}
        />
        {board.me.is_commissioner ? (
          <div style={{ textAlign: "center", padding: "0 26px 48px" }}>
            <ResetDraft
              picksMade={picksMade}
              busy={picking != null}
              onConfirm={() => void resetDraft()}
            />
          </div>
        ) : null}
      </>
    );
  }

  return (
    <>
      <audio ref={chime} src="/assets/nfl-draft-chime.mp3" preload="auto" />
      <DraftReveal pick={reveal} onClose={() => setReveal(null)} />
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 20,
          padding: "20px 26px 14px",
          flexWrap: "wrap",
        }}
      >
        <div>
          <div style={{ fontSize: 9, letterSpacing: ".28em", color: "#75798c" }}>ON THE CLOCK</div>
          <div style={{ fontFamily: "var(--font-heading)", fontSize: 32, marginTop: 4 }}>
            {board.league.state === "complete"
              ? "Draft complete"
              : board.onTheClock
                ? (managerName.get(board.onTheClock.manager_id ?? "") ?? "—")
                : "Waiting to start"}
          </div>
          <div style={{ fontSize: 11, color: "#75798c", marginTop: 2 }}>
            {board.onTheClock
              ? `Round ${board.onTheClock.round} · pick ${board.onTheClock.overall}`
              : `Draft ${board.league.state}`}
          </div>
        </div>

        <div style={{ display: "flex", gap: 4, marginLeft: "auto" }}>
          {(["players", "board"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              style={{
                padding: "6px 13px",
                fontSize: 10,
                letterSpacing: ".12em",
                textTransform: "uppercase",
                border: `1px solid ${view === v ? "rgba(181,171,252,.6)" : "rgba(145,132,217,.24)"}`,
                background: view === v ? "rgba(145,132,217,.26)" : "transparent",
                color: view === v ? "#e9e9ed" : "#9397ab",
                borderRadius: "var(--radius-sm)",
                font: "inherit",
                cursor: "pointer",
              }}
            >
              {v === "players" ? "Players" : "Board"}
            </button>
          ))}

          {board.me.is_commissioner ? (
            <>
              {/* Kept apart from the view toggle: one of these changes what
                  you are looking at, the other throws the draft away. */}
              <span
                aria-hidden
                style={{
                  width: 1,
                  alignSelf: "stretch",
                  margin: "0 5px",
                  background: "rgba(145,132,217,.22)",
                }}
              />
              <ResetDraft
                picksMade={picksMade}
                busy={picking != null}
                onConfirm={() => void resetDraft()}
              />
            </>
          ) : null}
        </div>

        {board.league.state === "running" ? (
          <div style={{ textAlign: "right" }}>
            <div
              style={{
                fontFamily: "var(--font-heading)",
                fontSize: 44,
                color: urgent ? "#e0b573" : "#d2cefd",
                animation: urgent ? "mt-pulse 1s ease infinite" : undefined,
              }}
            >
              {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, "0")}
            </div>
            <div style={{ fontSize: 9, letterSpacing: ".2em", color: "#75798c" }}>
              {board.myTurn ? "YOUR PICK" : "REMAINING"}
            </div>
          </div>
        ) : null}
      </div>

      {error ? (
        <div style={{ padding: "0 26px 8px", fontSize: 12, color: "#e0b573" }}>{error}</div>
      ) : null}

      {view === "board" ? (
        <div style={{ padding: "6px 26px 40px" }}>
          <div
            style={{
              border: "1px solid rgba(145,132,217,.22)",
              borderRadius: "var(--radius-lg)",
              background: "rgba(26,28,43,.55)",
              overflow: "hidden",
            }}
          >
            {/* Above the board rather than below it: the point is to see who
                is left without losing sight of who has gone. */}
            {board.league.state === "complete" ? null : (
              <DraftTicker available={board.available} />
            )}
            <DraftBoard
              picks={board.picks}
              managers={board.managers}
              meId={board.me.id}
              currentPick={board.league.currentPick}
            />
          </div>
        </div>
      ) : (
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0,1fr) minmax(260px,320px)",
          gap: 18,
          padding: "6px 26px 40px",
          alignItems: "start",
        }}
      >
        <div
          style={{
            border: `1px solid ${board.myTurn ? "rgba(181,171,252,.55)" : "rgba(145,132,217,.22)"}`,
            borderRadius: "var(--radius-lg)",
            background: "rgba(26,28,43,.55)",
            overflow: "hidden",
          }}
        >
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
            <h6 style={{ margin: 0, color: "#d2cefd" }}>Best available</h6>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search"
              style={{
                padding: "5px 9px",
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
                  onClick={() => setFilter(pos)}
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

          <div style={{ maxHeight: 560, overflowY: "auto" }}>
            {visible.length === 0 ? (
              <div style={{ padding: 16, fontSize: 12, color: "#75798c" }}>Nobody left here.</div>
            ) : null}

            {visible.map((p) => (
              <div
                key={p.name}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 11,
                  padding: "9px 16px",
                  borderTop: "1px solid rgba(145,132,217,.1)",
                  opacity: picking === p.name ? 0.5 : 1,
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
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
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
                  </div>
                  <div style={{ fontSize: 10, color: "#75798c", marginTop: 2 }}>
                    {p.posRank} · ADP {p.adp} · bye {p.bye}
                  </div>
                </div>
                <button
                  onClick={() => pick(p.name)}
                  disabled={!board.myTurn || picking != null}
                  style={{
                    padding: "6px 12px",
                    fontSize: 10,
                    letterSpacing: ".12em",
                    textTransform: "uppercase",
                    border: `1px solid ${board.myTurn ? "rgba(181,171,252,.6)" : "rgba(145,132,217,.2)"}`,
                    background: "transparent",
                    color: board.myTurn ? "#d2cefd" : "#5a5d6e",
                    borderRadius: "var(--radius-sm)",
                    font: "inherit",
                    cursor: board.myTurn ? "pointer" : "default",
                    flex: "0 0 auto",
                  }}
                >
                  Draft
                </button>
              </div>
            ))}
          </div>
        </div>

        <div
          style={{
            border: "1px solid rgba(145,132,217,.22)",
            borderRadius: "var(--radius-lg)",
            background: "rgba(26,28,43,.55)",
            padding: "14px 16px",
          }}
        >
          <h6 style={{ margin: "0 0 8px", color: "#d2cefd" }}>Recent picks</h6>
          {recent.length === 0 ? (
            <div style={{ fontSize: 11, color: "#75798c" }}>Nothing yet.</div>
          ) : null}
          {recent.map((p) => (
            <div
              key={p.overall}
              style={{ padding: "7px 0", borderTop: "1px solid rgba(145,132,217,.12)" }}
            >
              <div style={{ display: "flex", alignItems: "baseline", gap: 7 }}>
                <span style={{ fontSize: 10, color: "#75798c", width: 34, flex: "0 0 auto" }}>
                  {p.round}.{String(p.overall).padStart(2, "0")}
                </span>
                <span style={{ fontFamily: "var(--font-heading)", fontSize: 13, minWidth: 0 }}>
                  {p.player_name}
                </span>
              </div>
              <div style={{ fontSize: 10, color: "#75798c", marginLeft: 41 }}>
                {managerName.get(p.manager_id ?? "") ?? "—"}
              </div>
            </div>
          ))}
        </div>
      </div>
      )}
    </>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { headshot, logo } from "@/data/league-data";
import PlayerName from "./PlayerName";
import DraftBoard from "./DraftBoard";
import DraftCountdown from "./DraftCountdown";
import DraftReveal, { type RevealPick } from "./DraftReveal";
import DraftTicker from "./DraftTicker";
import IntroVideo, { type IntroHandle } from "./IntroVideo";
import DraftLottery from "./DraftLottery";
import PickClock from "./PickClock";
import ResetDraft from "./ResetDraft";
import TeamCrest from "./TeamCrest";
import { useLogos } from "@/lib/use-logos";
import { setPickAnimations, usePickAnimations } from "@/lib/use-pick-animations";
import { describeClock, pickSecondsFor, type ClockTier } from "@/lib/draft-clock";

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
  me: {
    id: string;
    slot: string;
    franchise: string;
    is_commissioner: boolean;
    ready: boolean;
    autodraft: boolean;
  };
  league: {
    /**
     * Draft night is a sequence, not a switch. Only "running" carries a pick
     * clock — which is what stops the intro film and the first manager's
     * ninety seconds from running at the same time.
     */
    state: "pending" | "lobby" | "lottery" | "running" | "paused" | "complete";
    currentPick: number;
    pickStartedAt: string | null;
    /** The clock for the round on the board now, not for the draft. */
    pickSeconds: number;
    pickClock: ClockTier[];
    serverNow: string;
    draftAt: string | null;
    cinematicRounds: number;
    introVideo: string | null;
    /** The drawn order, first pick first. Null until the lottery runs. */
    lotteryOrder: string[] | null;
    /** When the reveal began, so every screen animates from the same instant. */
    lotteryAt: string | null;
  };
  onTheClock: Pick | null;
  myTurn: boolean;
  picks: Pick[];
  managers: {
    id: string;
    slot: string;
    franchise: string;
    /** Whoever holds it, or null for a franchise nobody has claimed. */
    name?: string | null;
    ready?: boolean;
    autodraft?: boolean;
  }[];
  available: Available[];
  /** This manager's own list, in their own order. */
  queue: string[];
}

const POSITIONS = ["ALL", "QB", "RB", "WR", "TE", "K", "D/ST"];

/**
 * The commissioner's small controls in the room header.
 *
 * fontFamily rather than the `font` shorthand, here and everywhere else in
 * this app where a button sets its own size: `font: inherit` resets font-size
 * along with the family, so it silently threw away the 10px above it and drew
 * every one of these at the body's 15px. The family is the only part of it a
 * button needs to inherit.
 */
const control = (): React.CSSProperties => ({
  flex: "0 0 auto",
  whiteSpace: "nowrap",
  padding: "6px 13px",
  fontSize: 10,
  letterSpacing: ".12em",
  textTransform: "uppercase",
  border: "1px solid rgba(145,132,217,.34)",
  background: "transparent",
  color: "#9397ab",
  borderRadius: "var(--radius-sm)",
  fontFamily: "inherit",
  cursor: "pointer",
});

/**
 * Which showing of the film this is, for remembering it was watched.
 *
 * Keyed on the draft date so moving the date makes it new again — a postponed
 * draft ought to get its opening titles back. A league that never set a date
 * still needs a key, or the film would start over on every poll once everyone
 * was ready.
 */
function introKey(data: Board): string {
  return `gl.intro.${data.league.draftAt ?? "start"}`;
}

/** Whether this browser has already sat through this showing. */
function alreadyWatched(data: Board): boolean {
  try {
    return window.localStorage.getItem(introKey(data)) != null;
  } catch {
    // Private browsing, or storage turned off. Play it; seeing the intro
    // twice is not worth failing over.
    return false;
  }
}

export default function DraftRoom() {
  const logos = useLogos();
  const animations = usePickAnimations();
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("ALL");
  const [search, setSearch] = useState("");
  const [picking, setPicking] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [reveal, setReveal] = useState<RevealPick | null>(null);
  // The board is the reference view; the player list is where you pick from.
  const [view, setView] = useState<"players" | "board">("players");

  /**
   * The queue, held here as well as on the server.
   *
   * Reordering a list one round trip at a time is unusable — a manager
   * dragging the fourth name to the top would watch it snap back three times
   * while the server catches up. So the local copy leads and the server
   * follows, and the poll stops overwriting it while a write is in flight.
   */
  const [queue, setQueue] = useState<string[]>([]);
  const queueDirty = useRef(false);

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

  /**
   * The intro film belongs to the room, not to the countdown.
   *
   * It used to live inside the countdown, which is only on screen while the
   * draft is pending — so a commissioner who opened the room early skipped
   * straight past the film and nobody ever saw it. Held here it survives that
   * change, and can be started by any of the three things that mean "we are
   * beginning": the clock reaching zero, everybody pressing ready, or the
   * commissioner opening the room.
   */
  const intro = useRef<IntroHandle | null>(null);
  const [introPlaying, setIntroPlaying] = useState(false);
  // Whether the reveal has finished playing on *this* screen. The commissioner
  // cannot start round one over the top of the ceremony everybody is watching.
  const [lotteryDone, setLotteryDone] = useState(false);
  // Set the moment a decision to play is taken, so the poll that follows a
  // second later does not take it again.
  const introStarted = useRef(false);

  /**
   * Remembers the film has been watched — on finishing or skipping, never on
   * starting, so a refresh partway through plays it again rather than losing
   * it for good.
   */
  function finishIntro() {
    setIntroPlaying(false);
    if (!board) return;
    try {
      window.localStorage.setItem(introKey(board), "1");
    } catch {
      // As above: nothing here is worth an error.
    }
  }

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
      // Not while this browser is mid-write: the server's answer is behind
      // what the manager is looking at until the write lands.
      if (!queueDirty.current) setQueue(data.queue ?? []);
      setError(null);

      // Everybody in, or the commissioner has opened the room. The countdown
      // reaching zero is the third way in, and it reports itself from the tick
      // that already draws it.
      const everyoneIn =
        data.managers.length > 0 && data.managers.every((m) => m.ready === true);
      // The room being open, which is now its own state rather than the draft
      // having started. That separation is the point: the film plays here, and
      // nobody is on a clock while it does.
      const opened = data.league.state === "lobby";

      if (
        (everyoneIn || opened) &&
        data.league.introVideo &&
        !introStarted.current &&
        !alreadyWatched(data)
      ) {
        introStarted.current = true;
        setIntroPlaying(true);
      }
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

    // This browser's own choice. The other eleven screens are unaffected —
    // nothing about it leaves this machine.
    if (!animations) return;

    setReveal({
      playerName: latest.player_name!,
      franchise: managerName.get(latest.manager_id ?? "") ?? "—",
      slot: "",
      overall: latest.overall,
      round: latest.round,
      mine: latest.manager_id === board.me.id,
    });
  }, [board, managerName, animations]);

  const visible = useMemo(() => {
    if (!board) return [];
    const q = search.trim().toLowerCase();
    return board.available.filter((p) => {
      if (filter !== "ALL" && p.position !== filter) return false;
      if (q && !p.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [board, filter, search]);

  /** Draws the order and starts the reveal. The server picks it, not this. */
  async function drawLottery() {
    if (picking) return;
    setPicking("__lottery__");
    try {
      const res = await fetch("/api/admin/draft", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lottery: true }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) setError(body.error ?? "The lottery did not run.");
      else setError(null);
      await load();
    } catch {
      setError("The lottery did not run.");
    } finally {
      setPicking(null);
    }
  }

  async function setDraftState(state: "lobby" | "lottery" | "running" | "paused") {
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

  /**
   * Writes the queue as the manager has just arranged it.
   *
   * The whole list every time, because a queue is an order and almost every
   * edit to one renumbers most of it. Optimistic: the list on screen changes
   * first and is put back if the write fails, since a queue is a note to
   * yourself and waiting on a round trip to watch a name move is the wrong
   * amount of ceremony for one.
   */
  async function saveQueue(next: string[]) {
    const before = queue;
    queueDirty.current = true;
    setQueue(next);

    try {
      const res = await fetch("/api/draft/queue", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ players: next }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setQueue(before);
        setError(body.error ?? "Could not save your queue.");
      } else {
        setError(null);
      }
    } catch {
      setQueue(before);
      setError("Could not save your queue.");
    } finally {
      queueDirty.current = false;
    }
  }

  function queuePlayer(name: string) {
    if (queue.includes(name)) return;
    void saveQueue([...queue, name]);
  }

  function unqueuePlayer(name: string) {
    void saveQueue(queue.filter((n) => n !== name));
  }

  function moveInQueue(index: number, by: number) {
    const to = index + by;
    if (to < 0 || to >= queue.length) return;
    const next = [...queue];
    [next[index], next[to]] = [next[to], next[index]];
    void saveQueue(next);
  }

  /**
   * "I will not be here."
   *
   * Not the same thing as a clock running out. A manager who has said so is
   * picked for the moment their turn comes round rather than costing the other
   * eleven a minute a round, and the queue above is what they are picked from.
   */
  async function toggleAutodraft(on: boolean) {
    if (picking) return;
    setPicking("__autodraft__");
    try {
      const res = await fetch("/api/draft/autodraft", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ on }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Could not change autodraft.");
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

  async function nudgeClock(seconds: number) {
    if (picking) return;
    setPicking("__clock__");
    try {
      const res = await fetch("/api/admin/draft", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ nudgeSeconds: seconds }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) setError(body.error ?? "Could not move the clock.");
      else setError(null);
      await load();
    } finally {
      setPicking(null);
    }
  }

  /**
   * Take a pick.
   *
   * The commissioner may take one for whoever is on the clock — somebody whose
   * phone died, or who is stuck in traffic — which make_pick has always
   * allowed and nothing has ever offered. It is sent explicitly rather than
   * inferred, so a commissioner drafting for themselves and drafting for
   * somebody else are different requests.
   */
  async function pick(name: string) {
    if (picking || !board) return;

    const forSomebodyElse =
      !board.myTurn && board.me.is_commissioner && board.onTheClock?.manager_id;
    if (!board.myTurn && !forSomebodyElse) return;

    setPicking(name);
    try {
      const res = await fetch("/api/draft", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          player: name,
          ...(forSomebodyElse ? { forManager: board.onTheClock?.manager_id } : {}),
        }),
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


  // The commissioner can take the pick in hand for whoever is on the clock.
  // One value rather than the condition written twice, so what the button
  // looks like and what it does cannot drift apart.
  const canPick =
    board.league.state === "running" &&
    (board.myTurn || (board.me.is_commissioner && Boolean(board.onTheClock?.manager_id)));
  const pickingForSomeoneElse = canPick && !board.myTurn;
  const picksMade = board.picks.filter((p) => p.player_name).length;

  // The film, in one tree position for the life of the room. Moving it — or
  // letting it be unmounted when the draft opens — destroys the element the
  // Ready button unlocked the sound on, and it plays silently.
  const film = board.league.introVideo ? (
    <IntroVideo
      ref={intro}
      src={board.league.introVideo}
      open={introPlaying}
      onDone={finishIntro}
    />
  ) : null;

  // The room is open, the film has played (or there was none), and everybody
  // is waiting. Nobody is on a clock here — that is the whole point of the
  // state existing.
  // Rendered while the film is still playing too. The film is an overlay, so
  // what matters is what sits behind it — and without this the room fell
  // through to the draft board, which has no business being drawn for a state
  // that cannot pick.
  if (board.league.state === "lobby") {
    return (
      <>
        {film}
        <audio ref={chime} src="/assets/nfl-draft-chime.mp3" preload="auto" />
        <Waiting
          title="Everybody is here"
          line={
            board.me.is_commissioner
              ? "When the room is settled, draw the order. Nothing is on a clock until you start round one."
              : "The commissioner draws the order next. Nothing is on a clock yet — you have not missed anything."
          }
          managers={board.managers}
          error={error}
          action={
            board.me.is_commissioner
              ? { label: "Commence draft lottery", onClick: () => void drawLottery() }
              : null
          }
          busy={picking != null}
          clock={describeClock(board.league.pickClock)}
        />
      </>
    );
  }

  // The order, drawn in front of everybody. The reveal is a function of when
  // the commissioner pressed the button, so every screen is at the same point.
  if (board.league.state === "lottery") {
    return (
      <>
        {film}
        <audio ref={chime} src="/assets/nfl-draft-chime.mp3" preload="auto" />
        {error ? (
          <div style={{ padding: "0 26px", fontSize: 12, color: "#e0b573" }}>{error}</div>
        ) : null}
        {board.league.lotteryOrder && board.league.lotteryAt ? (
          <DraftLottery
            order={board.league.lotteryOrder}
            managers={board.managers}
            at={board.league.lotteryAt}
            skew={skew}
            onDone={() => setLotteryDone(true)}
          />
        ) : (
          <div style={{ padding: "26px", fontSize: 12.5, color: "#9397ab" }}>
            Drawing the order…
          </div>
        )}

        {board.me.is_commissioner ? (
          <div style={{ textAlign: "center", padding: "0 26px 48px" }}>
            <button
              onClick={() => void setDraftState("running")}
              disabled={picking != null || !lotteryDone}
              style={{
                minHeight: 44,
                padding: "12px 22px",
                border: `1px solid ${lotteryDone ? "rgba(181,171,252,.6)" : "rgba(145,132,217,.22)"}`,
                borderRadius: "var(--radius-sm)",
                background: lotteryDone ? "rgba(145,132,217,.18)" : "transparent",
                color: lotteryDone ? "#e9e9ed" : "#5a5d6e",
                font: "inherit",
                fontSize: 12,
                letterSpacing: ".14em",
                textTransform: "uppercase",
                cursor: lotteryDone && picking == null ? "pointer" : "default",
              }}
            >
              Commence draft
            </button>
            <div style={{ fontSize: 11.5, color: "#75798c", marginTop: 10 }}>
              {lotteryDone
                ? "Round one, and the pick clock, start when you press it."
                : "Available once every pick has been drawn."}
            </div>
          </div>
        ) : null}
      </>
    );
  }

  // Nothing to show a board for until the draft is open.
  if (board.league.state === "pending" || board.league.state === "paused") {
    return (
      <>
        {film}
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
          // This one button is two things. From pending it opens the room —
          // the film plays on that, and nobody is on a clock behind it. From
          // paused it is "resume", which must go straight back to running: a
          // draft halfway through round six does not want a lobby.
          onStart={() =>
            void setDraftState(board.league.state === "paused" ? "running" : "lobby")
          }
          busy={picking != null}
          meReady={board.me.ready}
          onReady={markReady}
          hasIntro={Boolean(board.league.introVideo)}
          onPrimeIntro={() => intro.current?.prime()}
          onCountdownReached={() => {
            if (!board.league.introVideo || introStarted.current) return;
            if (alreadyWatched(board)) return;
            introStarted.current = true;
            setIntroPlaying(true);
          }}
        />
        {/* What the clock does, before anybody is on it. A ladder is worth
            saying out loud once: a manager who learns ninety seconds in round
            one and finds out about sixty in round eleven by watching it run
            out has been told nothing. */}
        <div
          style={{
            textAlign: "center",
            padding: "0 26px 18px",
            fontSize: 11.5,
            color: "#75798c",
          }}
        >
          Pick clock — {describeClock(board.league.pickClock)}
        </div>

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
      {film}
      <audio ref={chime} src="/assets/nfl-draft-chime.mp3" preload="auto" />
      <DraftReveal pick={reveal} onClose={() => setReveal(null)} />
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          padding: "20px 26px 14px",
          flexWrap: "wrap",
        }}
      >
        {/* Shrinks rather than pushing the clock onto its own line: a long
            franchise name is worth less than the two of them being read in one
            glance, so it ellipses instead. */}
        <div style={{ flex: "1 1 150px", minWidth: 0 }}>
          <div style={{ fontSize: 10, letterSpacing: ".28em", color: "#75798c" }}>ON THE CLOCK</div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 11,
              fontFamily: "var(--font-heading)",
              // Gives way on a phone so the name and the clock share a line.
              // At a flat 32px the franchise on the clock read "Open T…".
              fontSize: "clamp(21px, 5.5vw, 32px)",
              marginTop: 4,
              minWidth: 0,
            }}
          >
            {board.onTheClock?.manager_id && board.league.state !== "complete" ? (
              <TeamCrest
                franchise={managerName.get(board.onTheClock.manager_id) ?? ""}
                logo={logos[board.onTheClock.manager_id] ?? null}
                size={32}
                shape="box"
                fallback="empty"
              />
            ) : null}
            <span
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                minWidth: 0,
              }}
            >
              {board.league.state === "complete"
                ? "Draft complete"
                : board.onTheClock
                  ? (managerName.get(board.onTheClock.manager_id ?? "") ?? "—")
                  : "Waiting to start"}
            </span>
          </div>
          <div style={{ fontSize: 11, color: "#75798c", marginTop: 2 }}>
            {board.onTheClock
              ? `Round ${board.onTheClock.round} · pick ${board.onTheClock.overall}` +
                // The clock shortens as the draft goes on, so the round has to
                // say which one it is on: a manager who learned ninety seconds
                // in round one should not find out about sixty in round eleven
                // by watching it run out.
                ` · ${pickSecondsFor(board.league.pickClock, board.onTheClock.round)}s clock`
              : `Draft ${board.league.state}`}
          </div>
        </div>

        {/* Beside the name rather than after the controls. On a phone the row
            of buttons below wraps, and the clock was landing a third of a
            screen under the franchise whose clock it is — the two things a
            manager looks up for, separated by everything they did not. */}
        {board.league.state === "running" ? (
          <PickClock
            remaining={remaining}
            total={board.league.pickSeconds}
            mine={board.myTurn}
          />
        ) : null}

        {/* The view toggle and, for the commissioner, the controls that change
            the draft itself. Wider than a phone either way: it used to wrap,
            which cost three rows of the screen before a single player was
            visible. One row that scrolls instead, in the order a draft
            actually needs them — what you are looking at, then what happens on
            your turn, then the commissioner's. Nothing hangs off the edge,
            because the rail can be dragged to it. */}
        <div
          className="gl-scroll-x"
          style={{
            display: "flex",
            gap: 4,
            marginLeft: "auto",
            flexWrap: "nowrap",
            flex: "0 1 auto",
            minWidth: 0,
            paddingBottom: 2,
          }}
        >
          {(["players", "board"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              style={{
                flex: "0 0 auto",
                padding: "6px 13px",
                fontSize: 10,
                letterSpacing: ".12em",
                textTransform: "uppercase",
                border: `1px solid ${view === v ? "rgba(181,171,252,.6)" : "rgba(145,132,217,.24)"}`,
                background: view === v ? "rgba(145,132,217,.26)" : "transparent",
                color: view === v ? "#e9e9ed" : "#9397ab",
                borderRadius: "var(--radius-sm)",
                fontFamily: "inherit",
                cursor: "pointer",
              }}
            >
              {v === "players" ? "Players" : "Board"}
            </button>
          ))}

          {/* Everybody's, not the commissioner's. A manager saying they will
              not be here is the one thing in this row that changes what the
              draft does for them rather than what this screen looks like. */}
          <label
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              flex: "0 0 auto",
              minHeight: 34,
              padding: "6px 11px",
              fontSize: 10,
              letterSpacing: ".1em",
              textTransform: "uppercase",
              color: board.me.autodraft ? "#e0b573" : "#9397ab",
              border: `1px solid ${board.me.autodraft ? "rgba(224,181,115,.55)" : "rgba(145,132,217,.24)"}`,
              borderRadius: "var(--radius-sm)",
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
            title="Pick for me the moment my turn comes round, from my queue first"
          >
            <input
              type="checkbox"
              checked={board.me.autodraft}
              disabled={picking != null}
              onChange={(e) => void toggleAutodraft(e.target.checked)}
              style={{ accentColor: "#e0b573", cursor: "pointer" }}
            />
            Autodraft
          </label>

          {/* This screen's own choice, not the league's. Everyone else still
              gets the reveal. */}
          <label
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              flex: "0 0 auto",
              padding: "6px 11px",
              fontSize: 10,
              letterSpacing: ".1em",
              textTransform: "uppercase",
              color: "#9397ab",
              border: "1px solid rgba(145,132,217,.24)",
              borderRadius: "var(--radius-sm)",
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
            title="Only on this screen. The other managers still see the reveal."
          >
            <input
              type="checkbox"
              checked={animations}
              onChange={(e) => setPickAnimations(e.target.checked)}
              style={{ accentColor: "#9184d9", cursor: "pointer" }}
            />
            Pick animation
          </label>

          {board.me.is_commissioner ? (
            <>
              {/* Kept apart from the view toggle: one of these changes what
                  you are looking at, the others change the draft. */}
              <span
                aria-hidden
                style={{
                  flex: "0 0 auto",
                  width: 1,
                  alignSelf: "stretch",
                  margin: "0 5px",
                  background: "rgba(145,132,217,.22)",
                }}
              />

              {/* The live controls. Pausing was reachable only from the paused
                  screen, which nobody can get to without pausing first — the
                  room could be started and never stopped. */}
              {board.league.state === "running" ? (
                <>
                  <button
                    onClick={() => void nudgeClock(30)}
                    disabled={picking != null}
                    title="Give the franchise on the clock another thirty seconds"
                    style={control()}
                  >
                    +30s
                  </button>
                  <button
                    onClick={() => void setDraftState("paused")}
                    disabled={picking != null}
                    title="Hold the draft where it is; nobody's clock runs"
                    style={control()}
                  >
                    Pause
                  </button>
                </>
              ) : null}

              {/* No Resume here: a paused draft shows the waiting room, which
                  carries its own. The type checker is what pointed that out. */}

              <ResetDraft
                picksMade={picksMade}
                busy={picking != null}
                onConfirm={() => void resetDraft()}
              />
            </>
          ) : null}
        </div>
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
      // One column, centred. The recent-picks panel that used to sit beside
      // this said the same thing as the board tab, and on a phone it pushed
      // the players — the only thing you are here to read — into a strip.
      <div
        style={{
          maxWidth: 780,
          margin: "0 auto",
          padding: "6px 26px 40px",
        }}
      >
        {/* ------------------------------------------------------ queue --- */}
        {/* The list that gets drafted for you. It has existed in the database
            since the room was built and no screen ever wrote to it, so the
            autodraft it feeds has always fallen through to best-available. */}
        <div
          style={{
            border: `1px solid ${board.me.autodraft ? "rgba(224,181,115,.4)" : "rgba(145,132,217,.22)"}`,
            borderRadius: "var(--radius-lg)",
            background: "rgba(26,28,43,.55)",
            overflow: "hidden",
            marginBottom: 12,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 10,
              padding: "11px 16px",
              borderBottom: queue.length ? "1px solid rgba(145,132,217,.18)" : undefined,
              flexWrap: "wrap",
            }}
          >
            <h6 style={{ margin: 0, color: "#d2cefd" }}>Your queue</h6>
            <span style={{ fontSize: 11, color: "#75798c" }}>
              {queue.length ? `${queue.length} queued` : "Nobody yet"}
            </span>
            {board.me.autodraft ? (
              <span style={{ fontSize: 11, color: "#e0b573", marginLeft: "auto" }}>
                Autodraft is on — these are who you get.
              </span>
            ) : null}
          </div>

          {queue.length === 0 ? (
            <div style={{ padding: "12px 16px", fontSize: 11.5, color: "#75798c", lineHeight: 1.6 }}>
              Queue players below and they are drafted for you, in this order,
              if your clock runs out or you switch autodraft on. Anyone already
              taken is skipped. With nothing queued you get the best available
              for what your roster still needs.
            </div>
          ) : (
            queue.map((name, i) => (
              <div
                key={name}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 9,
                  padding: "8px 16px",
                  borderTop: i === 0 ? undefined : "1px solid rgba(145,132,217,.1)",
                }}
              >
                <span
                  style={{
                    fontSize: 11,
                    color: "#75798c",
                    width: 18,
                    flex: "0 0 auto",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {i + 1}
                </span>
                <span style={{ minWidth: 0, flex: 1 }}>
                  <PlayerName
                    name={name}
                    plain
                    style={{ fontFamily: "var(--font-heading)", fontSize: 13.5 }}
                  />
                </span>
                <div style={{ display: "flex", gap: 3, flex: "0 0 auto" }}>
                  <button
                    onClick={() => moveInQueue(i, -1)}
                    disabled={i === 0}
                    aria-label={`Move ${name} up the queue`}
                    style={queueButton(i > 0)}
                  >
                    ↑
                  </button>
                  <button
                    onClick={() => moveInQueue(i, 1)}
                    disabled={i === queue.length - 1}
                    aria-label={`Move ${name} down the queue`}
                    style={queueButton(i < queue.length - 1)}
                  >
                    ↓
                  </button>
                  <button
                    onClick={() => unqueuePlayer(name)}
                    aria-label={`Take ${name} off your queue`}
                    style={queueButton(true)}
                  >
                    ×
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

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
                flex: "1 1 110px",
                minWidth: 0,
                padding: "5px 9px",
                background: "rgba(20,22,35,.8)",
                border: "1px solid rgba(145,132,217,.28)",
                borderRadius: "var(--radius-sm)",
                color: "#e9e9ed",
                font: "inherit",
                fontSize: 12,
              }}
            />
            {/* Seven of these wrapped onto two rows on a phone, which put the
                first player below the fold on the one screen where the list is
                the whole point. One rail, in position order, that scrolls. */}
            <div
              className="gl-scroll-x"
              style={{
                display: "flex",
                gap: 3,
                marginLeft: "auto",
                flexWrap: "nowrap",
                flex: "0 1 auto",
                minWidth: 0,
                paddingBottom: 2,
              }}
            >
              {POSITIONS.map((pos) => (
                <button
                  key={pos}
                  onClick={() => setFilter(pos)}
                  style={{
                    flex: "0 0 auto",
                    padding: "5px 9px",
                    fontSize: 10,
                    letterSpacing: ".1em",
                    border: `1px solid ${filter === pos ? "rgba(181,171,252,.6)" : "rgba(145,132,217,.24)"}`,
                    background: filter === pos ? "rgba(145,132,217,.26)" : "transparent",
                    color: filter === pos ? "#e9e9ed" : "#9397ab",
                    borderRadius: "var(--radius-sm)",
                    fontFamily: "inherit",
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
              <div className="gl-draft-row"
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
                  <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                    {/* Without somewhere to give, a long name holds the row
                        open and the line beneath it is squeezed to nothing. */}
                    <span
                      style={{
                        minWidth: 0,
                      }}
                    >
                      <PlayerName
                        name={p.name}
                        plain
                        style={{ fontFamily: "var(--font-heading)", fontSize: 14 }}
                      />
                    </span>
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
                  onClick={() =>
                    queue.includes(p.name) ? unqueuePlayer(p.name) : queuePlayer(p.name)
                  }
                  aria-label={
                    queue.includes(p.name)
                      ? `Take ${p.name} off your queue`
                      : `Add ${p.name} to your queue`
                  }
                  title={
                    queue.includes(p.name)
                      ? "On your queue — press to take them off"
                      : "Queue them: drafted for you if your clock runs out"
                  }
                  style={{
                    ...queueButton(true),
                    color: queue.includes(p.name) ? "#e0b573" : "#9397ab",
                    borderColor: queue.includes(p.name)
                      ? "rgba(224,181,115,.5)"
                      : "rgba(145,132,217,.28)",
                  }}
                >
                  {queue.includes(p.name) ? "★" : "+"}
                </button>
                <button
                  onClick={() => pick(p.name)}
                  disabled={!canPick || picking != null}
                  title={
                    pickingForSomeoneElse
                      ? `Draft for ${managerName.get(board.onTheClock?.manager_id ?? "") ?? "the franchise on the clock"}`
                      : undefined
                  }
                  style={{
                    padding: "6px 12px",
                    fontSize: 10,
                    letterSpacing: ".12em",
                    textTransform: "uppercase",
                    // Shrinks on a phone and wraps "Pick for them" over two
                    // lines rather than pushing itself onto a row of its own.
                    // It never shortens to "Pick": drafting for somebody else
                    // is the one press here that cannot be undone, and the
                    // words are what stop it being pressed by accident.
                    whiteSpace: "normal",
                    lineHeight: 1.2,
                    textAlign: "center",
                    border: `1px solid ${
                      pickingForSomeoneElse
                        ? "rgba(224,131,131,.45)"
                        : canPick
                          ? "rgba(181,171,252,.6)"
                          : "rgba(145,132,217,.2)"
                    }`,
                    background: "transparent",
                    color: pickingForSomeoneElse ? "#c98f8f" : canPick ? "#d2cefd" : "#5a5d6e",
                    borderRadius: "var(--radius-sm)",
                    fontFamily: "inherit",
                    cursor: canPick ? "pointer" : "default",
                    flex: "0 1 auto",
                    minWidth: 78,
                  }}
                >
                  {pickingForSomeoneElse ? "Pick for them" : "Draft"}
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
      )}
    </>
  );
}

/**
 * The small square buttons on a queue row.
 *
 * Thirty-four across whatever is in them: an arrow is two pixels wide and a
 * thumb is not, and this row is the one place on the page where four controls
 * sit side by side.
 */
function queueButton(enabled: boolean): React.CSSProperties {
  return {
    minWidth: 34,
    minHeight: 34,
    padding: "4px 8px",
    fontSize: 12,
    lineHeight: 1,
    border: "1px solid rgba(145,132,217,.28)",
    background: "transparent",
    color: enabled ? "#9397ab" : "#4d5062",
    borderRadius: "var(--radius-sm)",
    fontFamily: "inherit",
    cursor: enabled ? "pointer" : "default",
  };
}

/**
 * The screen between the film and the lottery.
 *
 * There was nothing here before, because there was nothing to wait for: the
 * room opened and the draft began in the same instant. Now that the two are
 * separate, twelve people are looking at something for a minute or two, and
 * "nothing is on a clock" is the one thing every one of them needs told.
 */
function Waiting({
  title,
  line,
  managers,
  error,
  action,
  busy,
  clock,
}: {
  title: string;
  line: string;
  managers: { id: string; slot: string; franchise: string; ready?: boolean }[];
  error: string | null;
  action: { label: string; onClick: () => void } | null;
  busy: boolean;
  clock: string;
}) {
  return (
    <div style={{ maxWidth: 640, margin: "0 auto", padding: "0 18px 48px", textAlign: "center" }}>
      <div style={{ fontSize: 10, letterSpacing: ".32em", color: "#75798c", marginTop: 40 }}>
        DRAFT NIGHT
      </div>
      <h1
        style={{
          fontFamily: "var(--font-heading)",
          fontSize: 34,
          letterSpacing: "-.03em",
          margin: "8px 0 10px",
          fontWeight: 500,
          color: "#e9e9ed",
        }}
      >
        {title}
      </h1>
      <p
        style={{
          fontSize: 12.5,
          color: "#9397ab",
          lineHeight: 1.7,
          margin: "0 auto 22px",
          maxWidth: "46ch",
        }}
      >
        {line}
      </p>

      {error ? (
        <div style={{ fontSize: 12, color: "#e0b573", marginBottom: 14 }}>{error}</div>
      ) : null}

      {action ? (
        <button
          onClick={action.onClick}
          disabled={busy}
          style={{
            minHeight: 44,
            padding: "12px 22px",
            border: "1px solid rgba(181,171,252,.6)",
            borderRadius: "var(--radius-sm)",
            background: "rgba(145,132,217,.18)",
            color: "#e9e9ed",
            font: "inherit",
            fontSize: 12,
            letterSpacing: ".14em",
            textTransform: "uppercase",
            cursor: busy ? "default" : "pointer",
          }}
        >
          {action.label}
        </button>
      ) : null}

      {/* Who is in the room. On a night when nothing is happening yet, this is
          the only thing on screen that changes — and it answers the question
          the commissioner is actually asking before pressing anything. */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 6,
          justifyContent: "center",
          margin: "26px 0 0",
        }}
      >
        {managers.map((m) => (
          <span
            key={m.id}
            style={{
              fontSize: 11,
              padding: "5px 10px",
              borderRadius: "var(--radius-sm)",
              border: `1px solid ${m.ready ? "rgba(127,209,168,.4)" : "rgba(145,132,217,.22)"}`,
              color: m.ready ? "#7fd1a8" : "#75798c",
            }}
          >
            {m.franchise}
          </span>
        ))}
      </div>

      <div style={{ fontSize: 11.5, color: "#75798c", marginTop: 22 }}>
        Pick clock — {clock}
      </div>
    </div>
  );
}

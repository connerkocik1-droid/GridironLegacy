"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import TeamCrest from "./TeamCrest";
import { useLogos } from "@/lib/use-logos";

/**
 * The league, talking.
 *
 * Everything this league does to each other happens through the app and none
 * of it could be answered inside it, so the reaction to every trade and every
 * defence left in on a bye happened in a group text. A league whose
 * conversation lives somewhere else is a league that lives somewhere else.
 *
 * Built as a room rather than a feed: newest at the bottom, the box at the
 * bottom too, and the view pinned to the end unless you have scrolled up to
 * read something — because a page that yanks you back to the bottom while you
 * are reading is worse than one that never moves.
 */

interface Message {
  id: string;
  managerId: string;
  body: string;
  at: string;
  mine: boolean;
}

interface Feed {
  me: { id: string; isCommissioner: boolean };
  managers: { id: string; name: string; franchise: string }[];
  messages: Message[];
}

/** How often the room asks for what it has not seen. */
const POLL_MS = 8_000;

const label: React.CSSProperties = {
  fontSize: 10,
  letterSpacing: ".2em",
  color: "#75798c",
};

/** The time, at the resolution a conversation cares about. */
function when(iso: string): string {
  const then = new Date(iso);
  const mins = (Date.now() - then.getTime()) / 60_000;
  if (mins < 1) return "just now";
  if (mins < 60) return `${Math.floor(mins)}m`;
  if (mins < 60 * 24) return `${Math.floor(mins / 60)}h`;
  return then.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function LeagueChat() {
  const logos = useLogos();
  const [feed, setFeed] = useState<Feed | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const scroller = useRef<HTMLDivElement | null>(null);
  // Whether the reader is at the bottom. Only then does new traffic scroll the
  // view; somebody scrolled up is reading, and moving the page under them is
  // the rudest thing a chat window can do.
  const pinned = useRef(true);
  const newest = useRef<string | null>(null);

  const load = useCallback(async (incremental: boolean) => {
    try {
      const since = incremental && newest.current ? `?since=${encodeURIComponent(newest.current)}` : "";
      const res = await fetch(`/api/chat${since}`, { cache: "no-store" });
      if (res.status === 401) return setError("Sign in to read the league.");
      if (!res.ok) return setError("Could not read the conversation.");

      const body: Feed = await res.json();
      setFeed(body);
      setError(null);

      setMessages((was) => {
        // An incremental poll returns only what is new, so it is appended;
        // a full load replaces. Either way the ids decide, because a message
        // this browser posted optimistically is already here.
        const merged = incremental ? [...was, ...body.messages] : body.messages;
        const seen = new Set<string>();
        return merged.filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)));
      });

      const last = body.messages[body.messages.length - 1];
      if (last) newest.current = last.at;
    } catch {
      setError("Could not read the conversation.");
    }
  }, []);

  useEffect(() => {
    // Sets state only once the request resolves, not synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(false);
  }, [load]);

  useEffect(() => {
    const timer = setInterval(() => {
      // A phone left on this page overnight should not spend the night asking
      // whether anybody said anything.
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      void load(true);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  // Follow the conversation, but only for a reader who is at the end of it.
  useEffect(() => {
    if (!pinned.current) return;
    const box = scroller.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [messages]);

  const nameOf = useMemo(() => {
    const map = new Map<string, { name: string; franchise: string }>();
    for (const m of feed?.managers ?? []) map.set(m.id, m);
    return map;
  }, [feed]);

  async function post() {
    const body = draft.trim();
    if (!body || sending) return;

    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body }),
      });
      const payload = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(typeof payload.error === "string" ? payload.error : "Could not post that.");
        return;
      }

      // Cleared only once it landed. A box that empties on a failed send has
      // eaten what somebody typed.
      setDraft("");
      pinned.current = true;
      setMessages((was) =>
        was.some((m) => m.id === payload.message.id) ? was : [...was, payload.message],
      );
      newest.current = payload.message.at;
    } catch {
      setError("Could not post that.");
    } finally {
      setSending(false);
    }
  }

  async function remove(id: string) {
    const before = messages;
    setMessages((was) => was.filter((m) => m.id !== id));
    try {
      const res = await fetch(`/api/chat?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) {
        setMessages(before);
        const body = await res.json().catch(() => ({}));
        setError(typeof body.error === "string" ? body.error : "Could not delete that.");
      }
    } catch {
      setMessages(before);
      setError("Could not delete that.");
    }
  }

  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: "0 18px 44px" }}>
      <div style={{ margin: "26px 0 6px" }}>
        <Link
          href="/the-league"
          style={{
            display: "inline-flex",
            alignItems: "center",
            minHeight: 34,
            fontSize: 11.5,
            color: "#b5abfc",
            textDecoration: "none",
          }}
        >
          ← The league
        </Link>
      </div>

      <div style={label}>THE GROUP CHAT</div>
      <h1
        style={{
          fontFamily: "var(--font-heading)",
          fontSize: 28,
          letterSpacing: "-.025em",
          margin: "7px 0 10px",
          fontWeight: 500,
          color: "#e9e9ed",
        }}
      >
        League chat
      </h1>
      <p style={{ fontSize: 12.5, color: "#9397ab", lineHeight: 1.65, margin: "0 0 16px" }}>
        Everyone in the league sees everything here. Nothing is emailed —
        this is the one place the app will not chase you about.
      </p>

      {error ? (
        <div
          style={{
            border: "1px solid rgba(224,181,115,.35)",
            borderRadius: "var(--radius-sm)",
            padding: "9px 12px",
            fontSize: 12,
            color: "#e0b573",
            marginBottom: 12,
          }}
        >
          {error}
        </div>
      ) : null}

      <div
        ref={scroller}
        onScroll={(e) => {
          const box = e.currentTarget;
          pinned.current = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
        }}
        style={{
          border: "1px solid rgba(145,132,217,.22)",
          borderRadius: "var(--radius-lg)",
          background: "rgba(26,28,43,.55)",
          padding: "6px 0",
          maxHeight: "58vh",
          minHeight: 220,
          overflowY: "auto",
        }}
      >
        {!feed ? (
          <div style={{ padding: "16px 18px", fontSize: 12.5, color: "#75798c" }}>
            Reading the conversation…
          </div>
        ) : messages.length === 0 ? (
          <div style={{ padding: "16px 18px", fontSize: 12.5, color: "#9397ab", lineHeight: 1.65 }}>
            Nobody has said anything yet. Somebody has to go first — it is
            traditionally an accusation about the last trade.
          </div>
        ) : (
          messages.map((m) => {
            const who = nameOf.get(m.managerId);
            const canDelete = m.mine || feed.me.isCommissioner;

            return (
              <div
                key={m.id}
                style={{
                  display: "flex",
                  gap: 10,
                  padding: "9px 16px",
                  alignItems: "flex-start",
                }}
              >
                <TeamCrest
                  franchise={who?.franchise ?? ""}
                  logo={logos[m.managerId] ?? null}
                  size={28}
                  shape="box"
                  fallback="empty"
                />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      gap: 8,
                      flexWrap: "wrap",
                    }}
                  >
                    <span
                      style={{
                        fontFamily: "var(--font-heading)",
                        fontSize: 13,
                        color: m.mine ? "#d2cefd" : "#e9e9ed",
                      }}
                    >
                      {who?.franchise ?? "Somebody"}
                    </span>
                    <span style={{ fontSize: 10.5, color: "#75798c" }}>{when(m.at)}</span>
                  </div>
                  <div
                    style={{
                      fontSize: 13,
                      color: "#c8ccdc",
                      lineHeight: 1.55,
                      marginTop: 2,
                      overflowWrap: "anywhere",
                      whiteSpace: "pre-wrap",
                    }}
                  >
                    {m.body}
                  </div>
                </div>
                {canDelete ? (
                  <button
                    onClick={() => void remove(m.id)}
                    aria-label={`Delete ${who?.franchise ?? "this"} message`}
                    title={m.mine ? "Take it back" : "Remove it"}
                    style={{
                      minWidth: 34,
                      minHeight: 34,
                      border: 0,
                      background: "transparent",
                      color: "#5a5d6e",
                      font: "inherit",
                      fontSize: 13,
                      cursor: "pointer",
                      flex: "0 0 auto",
                    }}
                  >
                    ×
                  </button>
                ) : null}
              </div>
            );
          })
        )}
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "flex-end" }}>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value.slice(0, 1000))}
          onKeyDown={(e) => {
            // Enter sends, shift-enter breaks the line — which is what every
            // other chat box anybody uses does.
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void post();
            }
          }}
          rows={2}
          placeholder="Say something"
          aria-label="Your message"
          style={{
            flex: 1,
            minWidth: 0,
            padding: "9px 11px",
            background: "rgba(20,22,35,.8)",
            border: "1px solid rgba(145,132,217,.28)",
            borderRadius: "var(--radius-sm)",
            color: "#e9e9ed",
            font: "inherit",
            fontSize: 13,
            lineHeight: 1.5,
            resize: "vertical",
          }}
        />
        <button
          onClick={() => void post()}
          disabled={!draft.trim() || sending}
          style={{
            minHeight: 40,
            padding: "9px 16px",
            border: `1px solid ${draft.trim() ? "rgba(181,171,252,.6)" : "rgba(145,132,217,.2)"}`,
            background: "transparent",
            color: draft.trim() ? "#d2cefd" : "#5a5d6e",
            borderRadius: "var(--radius-sm)",
            font: "inherit",
            fontSize: 12,
            letterSpacing: ".1em",
            textTransform: "uppercase",
            cursor: draft.trim() && !sending ? "pointer" : "default",
            flex: "0 0 auto",
          }}
        >
          Send
        </button>
      </div>
    </div>
  );
}

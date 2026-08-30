"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The film that opens draft night, over the whole room.
 *
 * The hard part is not the playing, it is the sound. A browser will not start
 * a video with audio until the person watching has interacted with the page,
 * and on draft night most of the room has done nothing but leave the countdown
 * open. So this asks for sound, and when it is refused it plays anyway with
 * the sound off and says so — one button away from having it. A silent intro
 * that ran is worth more than a loud one that did not.
 *
 * It is always skippable. Somebody arriving three minutes late does not want
 * to watch a minute of titles before they can see the board.
 */
export default function IntroVideo({
  src,
  onDone,
  caption,
}: {
  src: string;
  onDone: () => void;
  caption?: string;
}) {
  const video = useRef<HTMLVideoElement | null>(null);
  const [muted, setMuted] = useState(false);
  const [failed, setFailed] = useState(false);

  // onDone is rebuilt on every parent render — the countdown behind this
  // re-renders every second — so the listeners read it through a ref rather
  // than tearing themselves down and rebinding once a second.
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  }, [onDone]);

  useEffect(() => {
    const el = video.current;
    if (!el) return;

    let alive = true;

    el.play().catch(() => {
      // Refused for want of an interaction. Mute it and try once more; that
      // is always allowed, and the unmute button is right there.
      if (!alive) return;
      el.muted = true;
      setMuted(true);
      el.play().catch(() => {
        // Refused even muted, or the file will not decode. Do not hold the
        // room hostage to it.
        if (alive) setFailed(true);
      });
    });

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") done.current();
    };
    window.addEventListener("keydown", onKey);

    return () => {
      alive = false;
      window.removeEventListener("keydown", onKey);
      el.pause();
    };
  }, [src]);

  function unmute() {
    const el = video.current;
    if (!el) return;
    el.muted = false;
    setMuted(false);
    void el.play().catch(() => setMuted(true));
  }

  return (
    <div
      role="dialog"
      aria-label="Draft intro"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 400,
        display: "grid",
        placeItems: "center",
        background: "#07080e",
        animation: "gl-fade 240ms ease",
      }}
    >
      <video
        ref={video}
        src={src}
        playsInline
        preload="auto"
        onEnded={() => done.current()}
        onError={() => setFailed(true)}
        style={{ width: "100%", height: "100%", objectFit: "contain", background: "#07080e" }}
      />

      {failed ? (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "grid",
            placeItems: "center",
            padding: 26,
            textAlign: "center",
          }}
        >
          <div>
            <div style={{ fontSize: 9, letterSpacing: ".3em", color: "#e0b573" }}>
              THE INTRO WOULD NOT PLAY
            </div>
            <p
              style={{
                fontSize: 13,
                color: "#9397ab",
                lineHeight: 1.7,
                maxWidth: "44ch",
                margin: "12px auto 20px",
              }}
            >
              The browser could not load or decode the file at that address. The
              draft is unaffected — carry on into the room.
            </p>
            <button onClick={() => done.current()} style={skip}>
              Into the draft
            </button>
          </div>
        </div>
      ) : null}

      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 24,
          display: "flex",
          justifyContent: "center",
          gap: 9,
          flexWrap: "wrap",
          padding: "0 20px",
        }}
      >
        {caption ? (
          <span
            style={{
              alignSelf: "center",
              fontSize: 9,
              letterSpacing: ".26em",
              color: "#75798c",
              marginRight: 6,
            }}
          >
            {caption}
          </span>
        ) : null}

        {muted && !failed ? (
          <button onClick={unmute} style={{ ...skip, borderColor: "rgba(181,171,252,.7)", color: "#d2cefd" }}>
            Turn the sound on
          </button>
        ) : null}

        {!failed ? (
          <button onClick={() => done.current()} style={skip}>
            Skip
          </button>
        ) : null}
      </div>
    </div>
  );
}

const skip: React.CSSProperties = {
  padding: "9px 18px",
  border: "1px solid rgba(145,132,217,.45)",
  background: "rgba(16,17,27,.72)",
  color: "#9397ab",
  borderRadius: "var(--radius-sm)",
  font: "inherit",
  fontSize: 11,
  letterSpacing: ".12em",
  textTransform: "uppercase",
  cursor: "pointer",
  backdropFilter: "blur(4px)",
};

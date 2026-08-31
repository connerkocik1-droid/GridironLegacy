"use client";

import { useEffect, useImperativeHandle, useRef, useState } from "react";

/** What the pre-draft screen holds on to, so Ready can unlock the sound. */
export interface IntroHandle {
  /**
   * Unlocks audio on this element, from inside a real click.
   *
   * The trick is to start it unmuted at zero volume and stop it in the same
   * breath: browsers count that as audible playback and mark the element
   * allowed, while nobody hears a thing and no frame is shown. Muting instead
   * would unlock nothing — muted playback is permitted anyway, which is
   * exactly why it proves nothing.
   */
  prime: () => void;
}

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
  open = true,
  ref,
}: {
  src: string;
  onDone: () => void;
  caption?: string;
  /**
   * False keeps the element mounted but out of sight and silent. The
   * countdown holds it that way so there is something to unlock when Ready is
   * pressed: a video element that does not exist yet cannot be primed, and one
   * created at the moment the film starts has missed its chance.
   */
  open?: boolean;
  ref?: React.Ref<IntroHandle>;
}) {
  const video = useRef<HTMLVideoElement | null>(null);
  const [muted, setMuted] = useState(false);
  const [failed, setFailed] = useState(false);

  useImperativeHandle(
    ref,
    () => ({
      prime: () => {
        const el = video.current;
        if (!el) return;

        el.muted = false;
        el.volume = 0;

        // Started and stopped in the same breath. The pause deliberately does
        // not wait on the play promise: awaiting it lets the film actually
        // run, and a short one reaches its end while the click is still being
        // handled — which the room then writes down as having been watched,
        // and nobody ever sees it. Calling pause() straight after play()
        // aborts it before a frame is shown. The promise rejects with that
        // abort, which is the expected outcome rather than a failure.
        const started = el.play();
        if (started) started.catch(() => {});
        el.pause();
        el.currentTime = 0;
        el.volume = 1;
      },
    }),
    [],
  );

  // onDone is rebuilt on every parent render — the countdown behind this
  // re-renders every second — so the listeners read it through a ref rather
  // than tearing themselves down and rebinding once a second.
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  }, [onDone]);

  useEffect(() => {
    const el = video.current;
    if (!el || !open) return;

    let alive = true;
    el.currentTime = 0;

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
  }, [src, open]);

  function unmute() {
    const el = video.current;
    if (!el) return;
    el.muted = false;
    setMuted(false);
    void el.play().catch(() => setMuted(true));
  }

  // One element, in one place in the tree, whether the film is showing or not.
  //
  // This is the whole mechanism. Ready unlocks the sound on a particular video
  // element, and if opening the film swapped the markup around that element
  // React would tear it down and build a new one — unlocked in the old node,
  // silent in the new. So the wrapper changes and the <video> inside it never
  // moves.
  return (
    <div
      role={open ? "dialog" : undefined}
      aria-label={open ? "Draft intro" : undefined}
      aria-hidden={open ? undefined : true}
      style={
        open
          ? {
              position: "fixed",
              inset: 0,
              zIndex: 400,
              display: "grid",
              placeItems: "center",
              background: "#07080e",
              animation: "gl-fade 240ms ease",
            }
          : {
              // Out of sight and out of the way, but still in the document —
              // an element that is display:none cannot be primed at all.
              position: "fixed",
              left: -9999,
              top: 0,
              width: 1,
              height: 1,
              opacity: 0,
              overflow: "hidden",
              pointerEvents: "none",
            }
      }
    >
      <video
        ref={video}
        src={src}
        playsInline
        // Metadata until it is wanted: a large film fetched in full for
        // everyone who merely opened the page is bandwidth nobody asked to
        // spend. Priming it on Ready starts the download in earnest anyway.
        preload={open ? "auto" : "metadata"}
        tabIndex={open ? undefined : -1}
        // Both guarded on `open`, and the first of those is not a nicety. The
        // hidden element is played for a moment to unlock its sound, and a
        // file whose header carries no duration — anything a browser recorded,
        // among others — can report itself finished the instant it starts.
        // Unguarded, that counts as the film having been watched: it is
        // written down as seen and nobody in the league ever gets to see it.
        onEnded={() => {
          if (open) done.current();
        }}
        onError={() => {
          if (open) setFailed(true);
        }}
        style={
          open
            ? {
                width: "100%",
                height: "100%",
                objectFit: "contain",
                background: "#07080e",
              }
            : { width: 1, height: 1 }
        }
      />

      {open ? (
        <>
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
                <div
                  style={{
                    fontSize: 9,
                    letterSpacing: ".3em",
                    color: "#e0b573",
                  }}
                >
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
                  The browser could not load or decode the file at that address.
                  The draft is unaffected — carry on into the room.
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
              <button
                onClick={unmute}
                style={{
                  ...skip,
                  borderColor: "rgba(181,171,252,.7)",
                  color: "#d2cefd",
                }}
              >
                Turn the sound on
              </button>
            ) : null}

            {!failed ? (
              <button onClick={() => done.current()} style={skip}>
                Skip
              </button>
            ) : null}
          </div>
        </>
      ) : null}
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

"use client";

import { useEffect, useState } from "react";

/**
 * The one thing standing between an iPhone and an app icon.
 *
 * Everything else about the home-screen app is declarative — the manifest says
 * standalone, the meta tags say capable, and a phone that launches the site
 * from an icon gets no address bar. None of that helps, because on iOS nothing
 * offers to install anything. Safari has no install prompt and never has; the
 * only way in is Share, then Add to Home Screen, four taps down a sheet nobody
 * opens by accident.
 *
 * So this is the whole of the "app": a line telling somebody where the button
 * is. It shows once, to the people it can help, and goes away for good when
 * dismissed.
 *
 * Deliberately not shown to:
 *
 *   anybody already launched from a home screen — the offer is already taken,
 *     and display-mode: standalone is how the browser says so
 *   anybody not on iOS — Android's own menu offers this without help, and
 *     Chrome fires its own prompt
 *   anybody who has dismissed it — kept in localStorage, so it is per browser
 *     rather than per session; an offer that returns every morning is nagging
 */

const DISMISSED = "gl.a2hs.dismissed";

/**
 * Whether this browser is one where the instructions below are true.
 *
 * User-agent sniffing, which is normally the wrong answer — but the question
 * here is genuinely "is this iOS Safari", because the four taps being
 * described are specific to it. There is no capability to feature-detect: the
 * thing being detected is the absence of an API.
 *
 * iPadOS reports itself as a Mac, so it is caught by the touch test rather
 * than the platform string. Chrome and Firefox on iOS run WebKit but keep
 * their own share sheets, and Add to Home Screen is not in them.
 */
function isIosSafari(): boolean {
  if (typeof navigator === "undefined") return false;

  const ua = navigator.userAgent;
  const iPhone = /iPad|iPhone|iPod/.test(ua);
  const iPad = ua.includes("Macintosh") && navigator.maxTouchPoints > 1;
  if (!iPhone && !iPad) return false;

  // CriOS is Chrome, FxiOS is Firefox, EdgiOS is Edge, OPT/OPiOS is Opera.
  return !/CriOS|FxiOS|EdgiOS|OPiOS|OPT\//.test(ua);
}

/** Whether the app is already running from a home-screen icon. */
function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  if (window.matchMedia?.("(display-mode: standalone)").matches) return true;
  // Safari's own, from before the standard one. Still the only one iOS sets.
  return (window.navigator as { standalone?: boolean }).standalone === true;
}

export default function AddToHomeScreen() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    // Everything this decides on is only knowable in a browser, so it is
    // decided after mount rather than rendered on the server and corrected.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setShow(() => {
      if (isStandalone() || !isIosSafari()) return false;
      try {
        return localStorage.getItem(DISMISSED) !== "1";
      } catch {
        // A browser with storage turned off gets the hint. Once.
        return true;
      }
    });
  }, []);

  if (!show) return null;

  return (
    <div
      role="note"
      style={{
        position: "fixed",
        // Above the home indicator, not under it.
        bottom: "calc(12px + env(safe-area-inset-bottom))",
        left: "calc(12px + env(safe-area-inset-left))",
        right: "calc(12px + env(safe-area-inset-right))",
        zIndex: 60,
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        padding: "12px 12px 12px 14px",
        borderRadius: "var(--radius-lg)",
        border: "1px solid rgba(181,171,252,.45)",
        background: "rgba(30,32,50,.96)",
        backdropFilter: "blur(10px)",
        boxShadow: "0 10px 30px rgba(0,0,0,.45)",
      }}
    >
      <div style={{ minWidth: 0, flex: 1, fontSize: 12.5, color: "#c8ccdc", lineHeight: 1.6 }}>
        <div
          style={{
            fontFamily: "var(--font-heading)",
            fontSize: 13.5,
            color: "#e9e9ed",
            marginBottom: 3,
          }}
        >
          Put this on your home screen
        </div>
        Tap <ShareGlyph /> below, then{" "}
        <span style={{ color: "#d2cefd" }}>Add to Home Screen</span>. It opens
        full screen, without the address bar.
      </div>

      <button
        onClick={() => {
          setShow(false);
          try {
            localStorage.setItem(DISMISSED, "1");
          } catch {
            // Nothing to do about it, and nothing worth saying: the offer is
            // gone for this visit either way.
          }
        }}
        aria-label="Dismiss"
        style={{
          minWidth: 34,
          minHeight: 34,
          flex: "0 0 auto",
          border: 0,
          background: "transparent",
          color: "#75798c",
          font: "inherit",
          fontSize: 15,
          cursor: "pointer",
        }}
      >
        ×
      </button>
    </div>
  );
}

/**
 * iOS's share icon, drawn rather than named.
 *
 * "Tap the share button" is the sentence every one of these hints uses, and it
 * is the sentence that fails: the button has no label on it. The shape is the
 * only unambiguous way to say which one.
 */
function ShareGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="15"
      height="15"
      aria-label="the share button"
      role="img"
      style={{ verticalAlign: "-2px", margin: "0 1px" }}
      fill="none"
      stroke="#d2cefd"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 3v12" />
      <path d="M8 7l4-4 4 4" />
      <path d="M6 12H5v8h14v-8h-1" />
    </svg>
  );
}

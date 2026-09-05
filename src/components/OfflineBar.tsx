"use client";

import { useEffect, useState } from "react";

/**
 * "You are looking at something old, and here is why."
 *
 * The service worker keeps the last good copy of each scoreboard and hands it
 * back when the network cannot be reached. That is the right behaviour and it
 * is also the most dangerous thing it does: a score on a screen is taken as
 * the score, and one that is quietly forty minutes old during a Sunday
 * afternoon is worse than no score at all.
 *
 * So it is never quiet. Whenever the phone says it is offline, the app says
 * what that means for the numbers on the screen — and takes it back the
 * moment the connection returns, by asking every board to load again.
 *
 * navigator.onLine is not a promise that a request will succeed; it is a
 * promise that one will fail. That asymmetry is exactly the right way round
 * for this: it never claims to be online when it is not.
 */
export default function OfflineBar() {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const sync = () => setOffline(!navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  if (!offline) return null;

  return (
    <div
      role="status"
      className="gl-offline"
      style={{
        position: "fixed",
        left: 0,
        right: 0,
        // Sits at the very bottom; the stylesheet lifts it above the tab bar on
        // a phone, where the bar exists. Written there rather than here
        // because globals.css is the only place that knows the bar's height
        // and whether it is on screen at all.
        bottom: 0,
        zIndex: 45,
        padding: "9px 16px",
        textAlign: "center",
        fontSize: 11.5,
        letterSpacing: ".04em",
        color: "var(--bg)",
        background: "var(--warn)",
      }}
    >
      Offline — showing the last scores this phone had.
    </div>
  );
}

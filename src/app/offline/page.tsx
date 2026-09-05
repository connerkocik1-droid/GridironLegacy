import Link from "next/link";

export const metadata = { title: "Offline · Pylon Fantasy" };

/**
 * The screen for a dead zone.
 *
 * Precached by the service worker and shown only when a page cannot be
 * fetched at all. It is deliberately a real page of this app rather than the
 * browser's error: launched from a home screen there is no address bar and no
 * reload button, so a manager in a lift gets a dinosaur and no way out of it.
 *
 * It says the one useful thing — the boards you already opened are still
 * there — because they are: the worker keeps the last good copy of the
 * scoreboards, so going back to a screen you have already seen works.
 */
export default function OfflinePage() {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: "40px 26px",
        background:
          "radial-gradient(120% 80% at 50% -10%,rgb(var(--glow-rgb) / .4),transparent 60%),var(--bg)",
      }}
    >
      <div style={{ maxWidth: "34ch", textAlign: "center" }}>
        <svg width="52" height="86" viewBox="0 0 11 18" aria-hidden style={{ opacity: 0.55 }}>
          <path d="M2.6 0 h4.2 l2.6 18 h-9.4 z" fill="#f0913f" />
          <path d="M6.8 0 h1.6 l2.2 18 h-1.6 z" fill="#b8511f" />
        </svg>

        <h1
          style={{
            fontFamily: "var(--font-heading)",
            fontSize: 28,
            letterSpacing: "-.03em",
            fontWeight: 500,
            margin: "18px 0 8px",
          }}
        >
          No signal
        </h1>

        <p style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.65, margin: "0 0 20px" }}>
          Pylon cannot reach the league right now. Screens you have already opened still work — they
          will show the last scores this phone had, and say so.
        </p>

        <Link
          href="/"
          style={{
            display: "inline-flex",
            alignItems: "center",
            minHeight: 40,
            padding: "10px 18px",
            fontFamily: "var(--font-heading)",
            fontSize: 13,
            textDecoration: "none",
            color: "var(--text)",
            background: "rgb(var(--accent-rgb) / .26)",
            border: "1px solid rgb(var(--accent-bright-rgb) / .5)",
            borderRadius: "var(--radius-sm)",
          }}
        >
          Try again
        </Link>
      </div>
    </div>
  );
}

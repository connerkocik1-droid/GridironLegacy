import type { MetadataRoute } from "next";

/**
 * What a phone needs in order to treat this as an app rather than a page.
 *
 * Added to a home screen and launched, the site opens without Safari's address
 * bar and its toolbar — about a hundred and thirty pixels of a phone screen
 * given back to the thing somebody opened it for. On a Sunday afternoon that
 * is roughly two more rows of a live matchup.
 *
 * `display: standalone` is the whole of the trick, on both platforms. iOS also
 * wants the apple-mobile-web-app meta tags, which layout.tsx sets, and an
 * apple-touch-icon, which it does not read from here — without one, adding the
 * site to a home screen gives you a screenshot of whatever page you were on.
 *
 * Everything else here decides what the launch looks like. background_color is
 * painted before a single byte of the app has run, so it is the app's own
 * background: any other value is a white flash on every cold start.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Gridiron Legacy",
    // What actually fits under an icon on a home screen. iOS truncates at
    // about twelve characters, so the long name would read "Gridiron Le…".
    short_name: "Gridiron",
    description: "A dynasty fantasy football league.",

    // The home page, not whichever page was open when it was added. A manager
    // who added the site from a player profile should not launch into that
    // player's profile every morning for the rest of the season.
    start_url: "/",

    // Anything under the site's own root counts as in-app; a link that leaves
    // it opens in the browser, which is what you want for an ESPN box score.
    scope: "/",

    display: "standalone",

    // No orientation lock. It is tempting — the app is designed portrait and
    // used one-handed — but the draft board and the standings table are wide
    // enough to scroll sideways, and turning the phone is exactly what
    // somebody does about that. A lock would take the fix away.

    // The app's own ground, so a cold start fades up from the background it is
    // about to draw rather than flashing white first.
    background_color: "#161826",
    theme_color: "#161826",

    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      // Cropped to whatever shape the launcher likes — a circle on most
      // Android home screens. The mark inside is drawn small enough to survive
      // that; the plain icons above would lose the tops of the uprights.
      {
        src: "/icons/icon-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}

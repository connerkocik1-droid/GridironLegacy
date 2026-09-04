/**
 * The screen iOS shows while a home-screen launch is starting.
 *
 *   node scripts/icons/build-launch.mjs
 *
 * Android reads the manifest and draws its own splash from name,
 * background_color and the 512px icon. iOS does not: without an
 * apple-touch-startup-image it shows a blank screen for the second or so
 * between tapping the icon and the app painting, which is the difference
 * between "an app" and "a bookmark that took a moment".
 *
 * It also insists on an exact match. A launch image whose pixel dimensions are
 * not the device's is ignored outright — there is no scaling and no nearest
 * fit — so this writes one file per screen rather than one file. The list is
 * every iPhone still in use, portrait only: this app is used one-handed and a
 * landscape launch is rare enough not to be worth doubling the count for.
 *
 * The artwork is the app icon's own pylon on the app's own background, so the
 * OS splash and the app's first frame are the same picture and the handover is
 * invisible. Run it when the artwork changes and commit what it writes.
 */
import sharp from "sharp";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const out = join(root, "public", "icons", "launch");

/**
 * [css width, css height, device pixel ratio] — the three things iOS matches
 * on. The comment beside each is what it is, so the next person adding a
 * handset can see whether theirs is already covered.
 */
const SCREENS = [
  [320, 568, 2], // SE (1st)
  [375, 667, 2], // 8, SE (2nd, 3rd)
  [414, 736, 3], // 8 Plus
  [375, 812, 3], // X, XS, 11 Pro, 12 mini, 13 mini
  [414, 896, 2], // XR, 11
  [414, 896, 3], // XS Max, 11 Pro Max
  [390, 844, 3], // 12, 12 Pro, 13, 13 Pro, 14
  [428, 926, 3], // 12 Pro Max, 13 Pro Max, 14 Plus
  [393, 852, 3], // 14 Pro, 15, 15 Pro, 16
  [430, 932, 3], // 14 Pro Max, 15 Plus, 15 Pro Max, 16 Plus
  [402, 874, 3], // 16 Pro
  [440, 956, 3], // 16 Pro Max
];

/**
 * The same pylon as the icon, on the app's own ground.
 *
 * The mark is sized against the shorter edge so it is the same size in the
 * hand on every screen, and sits a little above the middle — where an eye
 * looks first, and where it is not under the home indicator.
 */
function launchSvg(w, h) {
  const mark = Math.round(Math.min(w, h) * 0.26);
  const x = Math.round((w - mark) / 2);
  const y = Math.round(h * 0.5 - mark * 0.62);

  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <radialGradient id="sky" cx="50%" cy="-10%" r="95%">
      <stop offset="0" stop-color="#423a6a" stop-opacity="0.4"/>
      <stop offset="0.6" stop-color="#423a6a" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="face" gradientUnits="userSpaceOnUse" x1="0" y1="${y}" x2="0" y2="${y + mark}">
      <stop offset="0" stop-color="#ffb066"/>
      <stop offset="1" stop-color="#e2662a"/>
    </linearGradient>
    <linearGradient id="side" gradientUnits="userSpaceOnUse" x1="0" y1="${y}" x2="0" y2="${y + mark}">
      <stop offset="0" stop-color="#d97b3c"/>
      <stop offset="1" stop-color="#a8431a"/>
    </linearGradient>
  </defs>

  <rect width="${w}" height="${h}" fill="#161826"/>
  <rect width="${w}" height="${h}" fill="url(#sky)"/>

  <g transform="translate(${x} ${y}) scale(${mark / 512})">
    <path d="M196 128 h84 l28 264 h-140 z" fill="url(#face)"/>
    <path d="M280 128 h36 l24 264 h-32 z" fill="url(#side)"/>
    <rect x="150" y="392" width="212" height="22" rx="11" fill="#2b2741"/>
  </g>
</svg>`);
}

mkdirSync(out, { recursive: true });

for (const [w, h, dpr] of SCREENS) {
  const px = { w: w * dpr, h: h * dpr };
  const name = `launch-${w}x${h}@${dpr}x.png`;
  await sharp(launchSvg(px.w, px.h))
    .png({ compressionLevel: 9, palette: true })
    .toFile(join(out, name));
  console.log(`${name}  ${px.w}×${px.h}`);
}

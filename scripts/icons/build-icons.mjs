/**
 * Turns the one drawn icon into the sizes a home screen asks for.
 *
 *   node scripts/icons/build-icons.mjs
 *
 * Four files, because four is what is actually needed and every extra one is
 * a thing that can fall out of step with the others:
 *
 *   apple-touch-icon.png  180  iOS. Without it, adding the site to a home
 *                              screen gives you a screenshot of the page,
 *                              which is how a home screen ends up with an
 *                              unreadable grey square on it.
 *   icon-192.png          192  Android's home screen, and the manifest.
 *   icon-512.png          512  The splash screen iOS and Android draw while
 *                              the app starts.
 *   icon-maskable.png     512  The same mark pulled into the middle eighty per
 *                              cent, for platforms that crop the icon to a
 *                              circle or a squircle of their own choosing.
 *
 * Run it when the artwork changes, and commit what it writes. Generating icons
 * at build time would mean sharp on the deployment path for four files that
 * change about once a year.
 */
import sharp from "sharp";
import { readFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const out = join(root, "public", "icons");
const svg = readFileSync(join(here, "app-icon.svg"));

mkdirSync(out, { recursive: true });

/**
 * The maskable variant: the same drawing with the mark pulled in to the
 * middle eighty per cent, the background left full-bleed.
 *
 * Done in the SVG rather than by padding a finished PNG. Padding composites a
 * flat colour around art whose own background is a gradient, which leaves a
 * visible square seam where the two meet — the first version of this file did
 * exactly that and it looked like a sticker on a tile.
 */
const shrunk = (source) =>
  Buffer.from(
    source
      .toString()
      .replace('<g id="mark"', '<g id="mark" transform="translate(51.2 51.2) scale(0.8)"'),
  );

const sizes = [
  ["apple-touch-icon.png", 180, svg],
  ["icon-192.png", 192, svg],
  ["icon-512.png", 512, svg],
  ["icon-maskable.png", 512, shrunk(svg)],
];

for (const [name, size, source] of sizes) {
  await sharp(source, { density: 384 })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toFile(join(out, name));
  console.log(`${name}  ${size}×${size}`);
}

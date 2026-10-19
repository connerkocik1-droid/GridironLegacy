/**
 * A franchise's mark when nobody has uploaded one, in both skins.
 *
 * Ported from teamLogo / teamLogoPx / spriteFor in prototype/Pylon App.dc.html.
 * Everything is drawn from one seed, so a team keeps the same hue, shape and
 * pattern whether the app is on glass or on a sixteen-bit console: the modern
 * badge and the pixel one are the same identity at two resolutions, never two
 * different logos.
 *
 * Each returns a CSS background value (a url() around an SVG data URI) rather
 * than markup, so a tile can carry it in its style without an extra element.
 * Pure and cached — the same team is drawn in a dozen rows on one page.
 */

/** A small seeded generator. FNV-1a over the key, then an LCG. */
export function rng(key: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619) >>> 0;
  return () => {
    h = (Math.imul(h, 1103515245) + 12345) >>> 0;
    return h / 4294967296;
  };
}

const cache = new Map<string, string>();

function asBackground(svg: string): string {
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/** Up to two initials off a franchise name: "Blaze Syndicate" -> "BS". */
export function initialsOf(name: string): string {
  const words = String(name ?? "").split(/\s+/).filter(Boolean);
  const letters = words.slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");
  return letters || "?";
}

/** The seed's hue, for anything that wants to sit in the team's colour. */
export function teamHue(seed: string): number {
  return Math.floor(rng("logo" + seed)() * 360);
}

const SHAPES = [
  "M20 2 L36 8 V20 C36 30 28 36 20 38 C12 36 4 30 4 20 V8 Z",
  "M20 2 L36 11 V29 L20 38 L4 29 V11 Z",
  "M20 2 A18 18 0 1 1 19.99 2 Z",
  "M6 2 H34 Q38 2 38 6 V34 Q38 38 34 38 H6 Q2 38 2 34 V6 Q2 2 6 2 Z",
  "M20 1 L39 20 L20 39 L1 20 Z",
];

/** The modern badge: a shield, hex, circle, square or diamond with a stripe. */
export function teamLogo(seed: string, text = initialsOf(seed)): string {
  const key = `m:${seed}:${text}`;
  const held = cache.get(key);
  if (held) return held;

  const r = rng("logo" + seed);
  const h = Math.floor(r() * 360);
  const base = `oklch(0.6 0.13 ${h})`;
  const dark = `oklch(0.34 0.07 ${h})`;
  const lite = `oklch(0.93 0.03 ${h})`;
  const shape = SHAPES[Math.floor(r() * SHAPES.length)];
  const pats = [
    `<path d="M0 40 L40 0 V40 Z" fill="${dark}"/>`,
    `<rect x="0" y="15" width="40" height="10" fill="${dark}"/>`,
    `<path d="M0 14 L20 26 L40 14 V22 L20 34 L0 22 Z" fill="${dark}"/>`,
    `<circle cx="20" cy="20" r="11" fill="none" stroke="${dark}" stroke-width="4"/>`,
    `<rect x="0" y="0" width="20" height="40" fill="${dark}"/>`,
    "",
  ];
  const pat = pats[Math.floor(r() * pats.length)];
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><defs><clipPath id="c"><path d="${shape}"/></clipPath></defs>` +
    `<g clip-path="url(#c)"><rect width="40" height="40" fill="${base}"/>${pat}</g>` +
    `<path d="${shape}" fill="none" stroke="${lite}" stroke-opacity=".35" stroke-width="1.2"/>` +
    `<text x="20" y="24.5" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-size="${text.length > 2 ? 11 : 13}" font-weight="700" font-style="italic" fill="${lite}">${escapeXml(text)}</text></svg>`;

  const out = asBackground(svg);
  cache.set(key, out);
  return out;
}

/** Initials as a 3x5 bitmap, read left to right, top to bottom. */
const GLYPH: Record<string, string> = {
  A: "010101111101101", B: "110101110101110", C: "011100100100011", D: "110101101101110",
  E: "111100110100111", F: "111100110100100", G: "011100101101011", H: "101101111101101",
  I: "111010010010111", J: "001001001101010", K: "101101110101101", L: "100100100100111",
  M: "101111111101101", N: "110101101101101", O: "010101101101010", P: "110101110100100",
  Q: "010101101110011", R: "110101110101101", S: "011100010001110", T: "111010010010010",
  U: "101101101101111", V: "101101101101010", W: "101101111111101", X: "101101010101101",
  Y: "101101010010010", Z: "111001010100111",
};

/**
 * The same badge on a 16x16 grid: an ink outline, a two-tone fill and the
 * initials in the bitmap font. Same seed, same draw order as teamLogo, so the
 * hue and shape match the modern mark one for one.
 */
export function teamLogoPx(seed: string, text = initialsOf(seed)): string {
  const key = `px:${seed}:${text}`;
  const held = cache.get(key);
  if (held) return held;

  const r = rng("logo" + seed);
  const h = Math.floor(r() * 360);
  const shape = Math.floor(r() * 5);
  const pat = Math.floor(r() * 6);
  const base = `hsl(${h},58%,46%)`;
  const dark = `hsl(${h},52%,24%)`;
  const lite = "#f4efd8";
  const ink = "#050a26";

  const inShape = (u: number, v: number) =>
    shape === 0 ? (Math.abs(u) < 0.88 && v < 0.15) || (u * u) / 0.77 + ((v - 0.15) * (v - 0.15)) / 0.72 <= 1
    : shape === 1 ? Math.abs(v) <= 0.92 && Math.abs(u) * 0.87 + Math.abs(v) * 0.5 <= 0.9
    : shape === 2 ? u * u + v * v <= 0.92
    : shape === 3 ? Math.abs(u) <= 0.88 && Math.abs(v) <= 0.88
    : Math.abs(u) + Math.abs(v) <= 1;
  const inPat = (u: number, v: number) =>
    pat === 0 ? u + v > 0
    : pat === 1 ? Math.abs(v) < 0.25
    : pat === 2 ? v > Math.abs(u) * 0.6 - 0.15 && v < Math.abs(u) * 0.6 + 0.22
    : pat === 3 ? u * u + v * v > 0.14 && u * u + v * v < 0.36
    : pat === 4 ? u < 0
    : false;

  const N = 16;
  const uv = (n: number) => ((n + 0.5) / N) * 2 - 1;
  const cell = (x: number, y: number) => inShape(uv(x), uv(y));

  let rects = "";
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      if (!cell(x, y)) continue;
      const edge = !cell(x - 1, y) || !cell(x + 1, y) || !cell(x, y - 1) || !cell(x, y + 1);
      const fill = edge ? ink : inPat(uv(x), uv(y)) ? dark : base;
      rects += `<rect x="${x}" y="${y}" width="1" height="1" fill="${fill}"/>`;
    }
  }
  [...text.slice(0, 2).toUpperCase()].forEach((ch, i) => {
    const g = GLYPH[ch] ?? GLYPH.X;
    for (let k = 0; k < 15; k++) {
      if (g[k] !== "1") continue;
      rects += `<rect x="${4 + i * 4 + (k % 3)}" y="${5 + Math.floor(k / 3)}" width="1" height="1" fill="${lite}"/>`;
    }
  });

  const out = asBackground(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" shape-rendering="crispEdges">${rects}</svg>`,
  );
  cache.set(key, out);
  return out;
}

/**
 * A two-frame running player in a team's colours, 12x12 per frame laid side by
 * side (24x12). Drawn at 2x it is a 48px strip that ap-run steps across.
 */
export function spriteFor(seed: string): string {
  const key = `sp:${seed}`;
  const held = cache.get(key);
  if (held) return held;

  const h = teamHue(seed);
  const col: Record<string, string> = {
    h: `hsl(${h},60%,48%)`,
    j: `hsl(${h},55%,38%)`,
    w: "#f4efd8",
    k: "#050a26",
    s: "#d9a066",
  };
  const top = ["....hhhh....", "...hhhhhh...", "...hhhwwk...", "....hhhh....", "...jjjjjj...", "..sjjwwjjs..", "...jjjjjj...", "....kkkk...."];
  const frameA = top.concat(["...kk..kk...", "..kk....kk..", "..w......w..", "............"]);
  const frameB = top.concat(["....kkkk....", "....kkkk....", "....w..w....", "............"]);

  let rects = "";
  [frameA, frameB].forEach((frame, fi) =>
    frame.forEach((row, y) =>
      [...row].forEach((c, x) => {
        if (c !== ".") rects += `<rect x="${x + fi * 12}" y="${y}" width="1" height="1" fill="${col[c]}"/>`;
      }),
    ),
  );

  const out = asBackground(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 12" shape-rendering="crispEdges">${rects}</svg>`,
  );
  cache.set(key, out);
  return out;
}

function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** How long a stored video address may be. Generous for a signed URL. */
const MAX = 500;

/**
 * Checks an intro video address before it is saved.
 *
 * Two shapes are allowed and no others: an https address, or a path inside
 * this site — which is how a commissioner uses a file dropped into
 * public/assets rather than hosting it somewhere.
 *
 * Everything else is refused, and `data:` most deliberately. A video as a data
 * URI would sit in the league's settings blob, which is read on nearly every
 * page, and would be measured in megabytes.
 */
export function checkVideoSrc(value: string): { src: string } | { error: string } {
  const src = value.trim();

  if (!src) return { error: "Give the video an address, or clear it" };
  if (src.length > MAX) return { error: "That address is too long" };

  // A path inside the site: /assets/intro.mp4. Rejecting "//" keeps it from
  // being a protocol-relative address to somewhere else entirely.
  if (src.startsWith("/") && !src.startsWith("//")) return { src };

  let parsed: URL;
  try {
    parsed = new URL(src);
  } catch {
    return { error: "That is not an address a browser can open" };
  }

  if (parsed.protocol !== "https:") {
    return { error: "The address must start with https:// or be a path like /assets/intro.mp4" };
  }

  return { src };
}

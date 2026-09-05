import { logo } from "@/data/league-data";

/**
 * The little shield beside a player's name — or nothing at all.
 *
 * Seven places drew this, and all seven asked the same wrong question. They
 * guarded on the player having a team, which a free agent does: their team is
 * the string "FA". `logo()` correctly has no mark for that and returns an
 * empty string, so all seven rendered `<img src="">`.
 *
 * That is not a cosmetic fault. An empty `src` makes the browser resolve it
 * against the current document and fetch the *page* again, once per image —
 * and the draft room's player list is sixty of them, so opening it fired
 * sixty extra requests for the draft room. The console had been saying so on
 * every load.
 *
 * So the question is asked once, here, and it is the right one: is there a
 * mark? If there is not, there is no element.
 */
export default function TeamMark({
  team,
  size = 13,
  opacity = 0.8,
  className,
}: {
  /** The abbreviation, or null. "FA" is allowed and draws nothing. */
  team: string | null | undefined;
  size?: number;
  opacity?: number;
  className?: string;
}) {
  const src = team ? logo(team) : "";
  if (!src) return null;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className={className}
      src={src}
      alt=""
      width={size}
      height={size}
      style={{ objectFit: "contain", opacity, flex: "0 0 auto" }}
    />
  );
}

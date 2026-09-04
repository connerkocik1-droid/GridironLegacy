import Link from "next/link";
import { headshot } from "@/data/league-data";
import { timeAgo, type Story } from "@/lib/news";

/**
 * The wire. `highlight` names the players whose stories should be marked —
 * the Player News page passes a roster so a manager can see at a glance which
 * stories are about their own team.
 */
export default function NewsWire({
  stories,
  highlight,
  emptyMessage,
}: {
  stories: Story[];
  highlight?: Set<string>;
  emptyMessage?: string;
}) {
  if (!stories.length) {
    return (
      <div style={{ padding: "16px 18px", fontSize: 13, color: "#9397ab", lineHeight: 1.6 }}>
        {emptyMessage ??
          "The wire is quiet, or ESPN is not reachable right now. It refreshes every fifteen minutes."}
      </div>
    );
  }

  return (
    <div>
      {stories.map((story, i) => {
        const mine = highlight ? story.players.filter((p) => highlight.has(p)) : [];
        const face = mine.length ? headshot(mine[0]) : null;

        return (
          <article
            key={story.id}
            style={{
              display: "flex",
              gap: 14,
              padding: "14px 18px",
              borderTop: i === 0 ? undefined : "1px solid rgba(145,132,217,.12)",
              background: mine.length ? "rgba(66,58,106,.18)" : undefined,
              boxShadow: mine.length ? "inset 2px 0 0 rgba(181,171,252,.5)" : undefined,
            }}
          >
            {face ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={face}
                alt=""
                width={40}
                height={40}
                style={{
                  borderRadius: "50%",
                  objectFit: "contain",
                  border: "1px solid rgba(145,132,217,.3)",
                  background: "rgba(35,37,50,.7)",
                  flex: "0 0 auto",
                }}
              />
            ) : null}

            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 9, flexWrap: "wrap" }}>
                <h3
                  style={{
                    fontFamily: "var(--font-heading)",
                    fontSize: 15,
                    fontWeight: 500,
                    margin: 0,
                    lineHeight: 1.35,
                  }}
                >
                  {story.link ? (
                    <a
                      href={story.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        color: "inherit",
                        textDecoration: "none",
                        // A one-line headline is nineteen pixels of link, which
                        // on a phone is a target you miss. Padding rather than
                        // a min-height, so a headline that wraps to two lines
                        // still reads as one block of text.
                        display: "inline-block",
                        padding: "6px 0",
                      }}
                    >
                      {story.headline}
                    </a>
                  ) : (
                    story.headline
                  )}
                </h3>
                <span
                  style={{
                    fontSize: 10,
                    letterSpacing: ".1em",
                    color: "#75798c",
                    flex: "0 0 auto",
                  }}
                >
                  {timeAgo(story.published)}
                </span>
              </div>

              {story.description ? (
                <p
                  style={{
                    fontSize: 12.5,
                    color: "#9397ab",
                    lineHeight: 1.6,
                    margin: "5px 0 0",
                    maxWidth: "76ch",
                  }}
                >
                  {story.description}
                </p>
              ) : null}

              {mine.length ? (
                <div style={{ marginTop: 7, display: "flex", gap: 5, flexWrap: "wrap" }}>
                  {mine.map((name) => (
                    <Link
                      key={name}
                      href={`/player/${encodeURIComponent(name)}`}
                      style={{
                        fontSize: 10,
                        letterSpacing: ".1em",
                        padding: "0 9px",
                        borderRadius: 2,
                        border: "1px solid rgba(181,171,252,.45)",
                        color: "#b5abfc",
                        textDecoration: "none",
                        display: "inline-flex",
                        alignItems: "center",
                        // A chip is now a link to the player, so it has to be
                        // big enough to press with a thumb.
                        minHeight: 34,
                      }}
                    >
                      {name.toUpperCase()}
                    </Link>
                  ))}
                </div>
              ) : null}
            </div>
          </article>
        );
      })}
    </div>
  );
}

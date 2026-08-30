import Link from "next/link";
import Nav from "@/components/Nav";
import { isConfigured, serviceClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

interface Franchise {
  slot: string;
  name: string;
  franchise: string;
  claimed: boolean;
  isCommissioner: boolean;
}

/**
 * The franchises as they actually stand, so a league the commissioner has
 * resized does not contradict a hard-coded list of twelve.
 */
async function loadFranchises(): Promise<{ league: string | null; franchises: Franchise[] }> {
  if (!isConfigured() || !process.env.LEAGUE_ID) return { league: null, franchises: [] };

  try {
    const db = serviceClient();
    const { data: league } = await db
      .from("leagues")
      .select("name")
      .eq("id", process.env.LEAGUE_ID)
      .single();

    const { data } = await db
      .from("managers")
      .select("slot, name, franchise, pin_hash, is_commissioner")
      .eq("league_id", process.env.LEAGUE_ID)
      .order("slot");

    return {
      league: league?.name ?? null,
      franchises: (data ?? []).map((m) => ({
        slot: m.slot,
        name: m.name,
        franchise: m.franchise,
        claimed: m.pin_hash != null,
        isCommissioner: m.is_commissioner,
      })),
    };
  } catch {
    return { league: null, franchises: [] };
  }
}

export default async function HomePage() {
  const { league, franchises } = await loadFranchises();
  const claimed = franchises.filter((f) => f.claimed).length;

  return (
    <div
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(120% 80% at 50% -10%,rgba(66,58,106,.4),transparent 60%),#161826",
      }}
    >
      <Nav current="/" />

      <div style={{ padding: "24px 26px 40px" }}>
        <div style={{ fontSize: 9, letterSpacing: ".32em", color: "#75798c" }}>
          DYNASTY · SUPERFLEX
        </div>
        <h1
          style={{
            fontFamily: "var(--font-heading)",
            fontSize: 44,
            lineHeight: 1.04,
            letterSpacing: "-.035em",
            margin: "8px 0 6px",
            fontWeight: 500,
          }}
        >
          {league ?? "Gridiron Legacy"}
        </h1>

        {franchises.length === 0 ? (
          <p style={{ fontSize: 13, color: "#9397ab", lineHeight: 1.6, maxWidth: "60ch" }}>
            No league yet. Run <code>node scripts/seed.mjs</code> against your
            database to create one, then set <code>LEAGUE_ID</code>.
          </p>
        ) : (
          <>
            <p style={{ fontSize: 13, color: "#9397ab", margin: "0 0 20px" }}>
              {claimed} of {franchises.length} franchises claimed ·{" "}
              <Link href="/signin">claim one</Link>
            </p>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill,minmax(210px,1fr))",
                gap: 10,
              }}
            >
              {franchises.map((f) => (
                <div
                  key={f.slot}
                  style={{
                    border: `1px solid ${f.claimed ? "rgba(145,132,217,.34)" : "rgba(145,132,217,.16)"}`,
                    borderRadius: "var(--radius-md)",
                    padding: "12px 14px",
                    background: f.claimed ? "rgba(35,37,50,.6)" : "rgba(28,30,42,.4)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      fontSize: 9,
                      letterSpacing: ".2em",
                      color: "#75798c",
                    }}
                  >
                    {f.slot}
                    {f.isCommissioner ? <span style={{ color: "#b5abfc" }}>· COMMISSIONER</span> : null}
                  </div>
                  <div
                    style={{
                      fontFamily: "var(--font-heading)",
                      fontSize: 16,
                      marginTop: 4,
                      color: f.claimed ? "#e9e9ed" : "#9397ab",
                    }}
                  >
                    {f.franchise}
                  </div>
                  <div
                    style={{
                      fontSize: 10,
                      letterSpacing: ".14em",
                      marginTop: 6,
                      color: f.claimed ? "#7fd1a8" : "#75798c",
                    }}
                  >
                    {f.claimed ? f.name.toUpperCase() : "OPEN"}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

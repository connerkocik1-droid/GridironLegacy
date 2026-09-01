import HomeBoard from "@/components/HomeBoard";
import Nav from "@/components/Nav";
import SignIn from "@/components/SignIn";
import { currentManager } from "@/lib/session";
import { isConfigured, serviceClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

interface Franchise {
  slot: string;
  name: string;
  franchise: string;
  division: string | null;
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
      .select("slot, name, franchise, pin_hash, is_commissioner, division")
      .eq("league_id", process.env.LEAGUE_ID)
      .order("slot");

    return {
      league: league?.name ?? null,
      franchises: (data ?? []).map((m) => ({
        slot: m.slot,
        name: m.name,
        franchise: m.franchise,
        division: m.division,
        claimed: m.pin_hash != null,
        isCommissioner: m.is_commissioner,
      })),
    };
  } catch {
    return { league: null, franchises: [] };
  }
}

export default async function HomePage() {
  // Signed in, this is the league itself: the games, the lineup, the week's
  // fixtures and where everyone stands, all on one page. Signed out it is the
  // way in. Same address, because the front door of a league site should be
  // the league.
  //
  // "Signed in" means holding a franchise in this league, not merely having a
  // Supabase session — see currentManager. A session whose franchise has been
  // released, or which belongs to a league this deployment does not serve, used
  // to be shown the league anyway: a home page full of somebody else's team,
  // with no way back to the sign-in page, because this is the sign-in page.
  if (await currentManager()) {
    return (
      <div
        style={{
          minHeight: "100vh",
          background:
            "radial-gradient(120% 80% at 50% -10%,rgba(66,58,106,.4),transparent 60%),#161826",
        }}
      >
        <Nav current="/" />
        <HomeBoard />
      </div>
    );
  }

  const { league, franchises } = await loadFranchises();
  const claimed = franchises.filter((f) => f.claimed).length;
  const open = franchises.length - claimed;

  return (
    <div
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(120% 80% at 50% -10%,rgba(66,58,106,.4),transparent 60%),#161826",
      }}
    >
      {/* No nav for a signed-out visitor: every link behind it would only ask
          them to sign in, which is what this page is for. */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0,420px) minmax(0,1fr)",
          gap: 40,
          alignItems: "start",
          maxWidth: 1100,
          margin: "0 auto",
          padding: "48px 26px 60px",
        }}
      >
        <SignIn leagueName={league} />

        {franchises.length ? (
          <div>
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: 10,
                margin: "0 0 12px",
                flexWrap: "wrap",
              }}
            >
              <h2
                style={{
                  fontFamily: "var(--font-heading)",
                  fontSize: 15,
                  fontWeight: 500,
                  margin: 0,
                  color: "#d2cefd",
                }}
              >
                The league
              </h2>
              <span style={{ fontSize: 11, color: "#75798c" }}>
                {open > 0
                  ? `${open} of ${franchises.length} still open`
                  : "every franchise claimed"}
              </span>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill,minmax(min(190px,100%),1fr))",
                gap: 8,
              }}
            >
              {franchises.map((f) => (
                <div
                  key={f.slot}
                  style={{
                    border: `1px solid ${f.claimed ? "rgba(145,132,217,.34)" : "rgba(145,132,217,.16)"}`,
                    borderRadius: "var(--radius-md)",
                    padding: "10px 12px",
                    background: f.claimed ? "rgba(35,37,50,.6)" : "rgba(28,30,42,.35)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      fontSize: 10,
                      letterSpacing: ".18em",
                      color: "#75798c",
                    }}
                  >
                    {f.slot}
                    {f.division ? <span>· {f.division.toUpperCase()}</span> : null}
                    {f.isCommissioner ? <span style={{ color: "#b5abfc" }}>· COMM</span> : null}
                  </div>
                  <div
                    style={{
                      fontFamily: "var(--font-heading)",
                      fontSize: 14,
                      marginTop: 3,
                      color: f.claimed ? "#e9e9ed" : "#9397ab",
                    }}
                  >
                    {f.franchise}
                  </div>
                  <div
                    style={{
                      fontSize: 10,
                      letterSpacing: ".14em",
                      marginTop: 5,
                      color: f.claimed ? "#7fd1a8" : "#75798c",
                    }}
                  >
                    {f.claimed ? f.name.toUpperCase() : "OPEN"}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div style={{ fontSize: 13, color: "#9397ab", lineHeight: 1.7, maxWidth: "52ch" }}>
            <p style={{ margin: "0 0 10px" }}>No league yet.</p>
            <p style={{ margin: 0 }}>
              Run <code>supabase/seed.sql</code> against your database, then set{" "}
              <code>LEAGUE_ID</code>. <code>SETUP.md</code> has the steps in order.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

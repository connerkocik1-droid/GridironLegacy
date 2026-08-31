/**
 * One band of the home page. Every section is announced the same way, so a
 * page made of four unrelated things still reads as one page.
 */
export default function Section({
  eyebrow,
  title,
  aside,
  children,
  id,
}: {
  eyebrow: string;
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
  id?: string;
}) {
  return (
    <section id={id} style={{ padding: "26px 26px 0" }}>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 12,
          flexWrap: "wrap",
          margin: "0 0 12px",
        }}
      >
        <div>
          <div style={{ fontSize: 10, letterSpacing: ".32em", color: "#75798c" }}>{eyebrow}</div>
          <h2
            style={{
              fontFamily: "var(--font-heading)",
              fontSize: 22,
              letterSpacing: "-.02em",
              fontWeight: 500,
              margin: "5px 0 0",
            }}
          >
            {title}
          </h2>
        </div>
        {aside ? (
          <div style={{ marginLeft: "auto", fontSize: 11, color: "#75798c" }}>{aside}</div>
        ) : null}
      </div>
      {children}
    </section>
  );
}

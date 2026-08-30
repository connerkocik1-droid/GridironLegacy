"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

/**
 * The league office link, shown only to the manager who holds the office.
 *
 * The rest of the nav is static, rendered on the server and cached — which is
 * why this one item is a client component rather than the whole bar becoming
 * dynamic to answer one question. It asks who is signed in the same way every
 * other page in the app asks for its data.
 *
 * It renders nothing until the answer comes back, so the failure mode is the
 * commissioner waiting a beat for their own link rather than everyone else
 * glimpsing a tab that is not theirs. Hiding it is tidiness, not security: the
 * page itself turns away anyone else, and every commissioner action is
 * authorised again in SQL.
 */
export default function CommissionerLink({
  active,
  style,
}: {
  active: boolean;
  style: React.CSSProperties;
}) {
  const [isCommissioner, setIsCommissioner] = useState(false);

  useEffect(() => {
    const stop = new AbortController();

    fetch("/api/auth/me", { cache: "no-store", signal: stop.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setIsCommissioner(Boolean(data?.manager?.is_commissioner)))
      // Signed out, offline, or the database is not configured — either way
      // there is no office to offer.
      .catch(() => {});

    return () => stop.abort();
  }, []);

  if (!isCommissioner) return null;

  return (
    <Link href="/commissioner" style={style} aria-current={active ? "page" : undefined}>
      Commissioner
    </Link>
  );
}

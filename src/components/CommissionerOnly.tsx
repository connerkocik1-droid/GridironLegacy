"use client";

import { useOffice } from "@/lib/use-me";

/**
 * Shows its children to the commissioner, and to nobody else.
 *
 * Used two ways: around the office links in the nav, where there is nothing to
 * say to anyone else, and around the pages themselves with a `fallback` that
 * turns a manager away.
 *
 * Before the database is configured there is no league and no office, so
 * nothing is withheld — the rehearsal room in particular exists to be walked
 * through before any of this is wired up. Everywhere else the rule is a clear
 * yes or nothing: a request that fails leaves the children hidden.
 *
 * This is tidiness rather than security. The commissioner's actions are all
 * authorised again in SQL, where hiding a link cannot be mistaken for a lock.
 */
export default function CommissionerOnly({
  children,
  fallback = null,
}: {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  const office = useOffice();

  if (office === "commissioner" || office === "no-league") return <>{children}</>;
  if (office === "manager") return <>{fallback}</>;
  return null;
}

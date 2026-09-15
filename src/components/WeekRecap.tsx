"use client";

import { useCallback, useEffect, useState } from "react";
import RecapStage from "./RecapStage";
import { recapIsDue, type RecapData } from "@/lib/recap";

interface Answer {
  recap: RecapData | null;
  seenWeek: number | null;
  opensAt: number | null;
}

/**
 * Whether the week recap plays, and the one time it does.
 *
 * The NFL week ends on Monday night, so the recap belongs to Tuesday — and it
 * has to arrive on its own rather than be gone looking for. A manager who has
 * to find their week's recap will not, and a recap that plays on every launch
 * stops being a recap and becomes a door in the way of the app.
 *
 * So: once, on the first open after the week's football is over, and never
 * again for that week. The marker lives on the manager rather than in this
 * browser, because a manager with a phone and a laptop is one manager and
 * should be told about their week once.
 */
export default function WeekRecap() {
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [closed, setClosed] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch("/api/recap", { cache: "no-store" });
        if (!res.ok || !alive) return;
        const body = (await res.json()) as Answer;
        if (alive) setAnswer(body);
      } catch {
        // A recap nobody can fetch is a recap that does not play. There is
        // nothing to tell the manager about that: the app behind it is intact.
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const dismiss = useCallback(() => {
    setClosed(true);
    const week = answer?.recap?.week;
    if (week == null) return;
    // Marked as seen on the way out rather than on the way in: a manager who
    // closes the app halfway through has not been told about their week, and
    // should get it again next time they look.
    void fetch("/api/recap", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ week }),
    }).catch(() => {});
  }, [answer]);

  if (closed || !answer?.recap) return null;

  const due = recapIsDue({
    week: answer.recap.week,
    seenWeek: answer.seenWeek,
    opensAt: answer.opensAt,
  });
  if (!due) return null;

  return <RecapStage data={answer.recap} onDismiss={dismiss} />;
}

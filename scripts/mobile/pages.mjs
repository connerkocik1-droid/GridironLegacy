/**
 * Every page the audit drives, and what to call it in the table.
 *
 * Its own file because two things read it now: the audit, which measures the
 * geometry with the API answered from a fixture, and the console check, which
 * loads the same list against the real routes and listens instead of looking.
 * A page added to one and not the other is a page half checked.
 */
export const PAGES = [
  ["/", "home"],
  ["/activity", "activity"],
  ["/my-team", "my-team"],
  ["/the-league", "the-league"],
  ["/rules", "rules"],
  ["/chat", "chat"],
  ["/my-team/edit", "edit-team"],
  ["/watchlist", "watchlist"],
  ["/player/Puka%20Nacua", "player-profile"],
  ["/lineup", "lineup"],
  ["/matchups", "matchups"],
  ["/standings", "standings"],
  ["/rankings", "rankings"],
  ["/draft", "draft"],
  ["/draft/rehearsal", "rehearsal"],
  ["/draft/mock", "mock-draft"],
  ["/free-agents", "free-agents"],
  ["/trade-builder", "trade-builder"],
  ["/league", "league"],
  ["/news", "news"],
  ["/player-news", "player-news"],
  ["/pickem", "pickem"],
  ["/20-0", "twenty-zero"],
  ["/minigames", "minigames"],
  ["/commissioner", "commissioner"],
  ["/commissioner/preseason", "preseason-check"],
];

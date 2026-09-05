/**
 * Every screen arrives.
 *
 * A tab bar makes this feel like an app until you press something: the old
 * screen is replaced by the new one between two frames, with nothing in
 * between, which is the one moment the whole thing reads as a website again.
 * Native apps never do that — a screen comes in from somewhere, and the
 * coming-in is what tells you the press worked and which direction you went.
 *
 * A template rather than a layout, because a layout persists across
 * navigation and a template is rebuilt for each route — which is exactly the
 * mount the animation needs. The cost is that page state is not carried
 * between routes, which is what a manager expects anyway: going to My Team
 * and back is a fresh look at My Team.
 *
 * Deliberately small: eight pixels and two hundred milliseconds. Enough to
 * read as motion, not enough to be a thing you wait for on the fortieth
 * navigation of a draft night. The animation is on opacity and transform
 * only, and does not hold its transform at the end — a lingering transform
 * would make this element the containing block for every fixed overlay
 * underneath it, and the pick reveal is fixed.
 */
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="gl-enter">{children}</div>;
}

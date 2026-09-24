"use client";

/**
 * The title screen. A bouncing pylon, the name, and PRESS START.
 *
 * This exists because of one rule no amount of code gets around: a browser
 * will not play a sound until somebody has touched the page. The theme music
 * could be defaulted on, preloaded and asked politely to play, and on a cold
 * launch every one of those attempts is refused — so the retro theme's best
 * feature arrived only for whoever thought to hunt for the switch.
 *
 * A title screen turns that constraint into the thing it should always have
 * been. The press the browser is holding out for is the press a cartridge asks
 * for anyway, and the music starts on it, every time, on every platform,
 * without anybody being told about a button in a header.
 *
 * Only in the sixteen-bit theme. Anywhere else this would be a splash screen
 * on a website standing between somebody and their scores, which nobody has
 * ever thanked anybody for — and there would be no sound for it to unlock.
 *
 * Once per launch, not once per page. It is held in sessionStorage, so a
 * reload during a game goes straight through and only a genuinely cold open
 * sees it again.
 *
 * The whole sheet is the button. PRESS START is where the eye goes, but an
 * arcade cabinet answers to any button on it, and a manager holding a phone
 * one-handed should not have to aim.
 */
export default function PressStart({
  onStart,
  sound,
}: {
  onStart: () => void;
  /** Whether pressing will actually make a noise, which the note must not lie about. */
  sound: boolean;
}) {
  return (
    <div
      id="gl-start"
      role="button"
      tabIndex={0}
      aria-label="Start Pylon Fantasy"
      onPointerDown={onStart}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onStart();
        }
      }}
    >
      {/* The icon's own pylon, at the size the launch image draws it, so the
          OS splash and this are one picture. Bouncing rather than still: the
          static one says "loading", and this one is waiting for you. */}
      <svg className="gl-start-pylon" width="104" height="104" viewBox="0 0 512 512" aria-hidden>
        <defs>
          <linearGradient id="gl-start-face" gradientUnits="userSpaceOnUse" x1="0" y1="128" x2="0" y2="414">
            <stop offset="0" stopColor="#ffb066" />
            <stop offset="1" stopColor="#e2662a" />
          </linearGradient>
          <linearGradient id="gl-start-side" gradientUnits="userSpaceOnUse" x1="0" y1="128" x2="0" y2="414">
            <stop offset="0" stopColor="#d97b3c" />
            <stop offset="1" stopColor="#a8431a" />
          </linearGradient>
        </defs>
        <path d="M196 128 h84 l28 264 h-140 z" fill="url(#gl-start-face)" />
        <path d="M280 128 h36 l24 264 h-32 z" fill="url(#gl-start-side)" />
        <rect x="150" y="392" width="212" height="22" rx="11" fill="#2b2741" />
      </svg>

      <div className="gl-start-name">Pylon Fantasy</div>

      {/* A real button, inside a sheet that is also pressable. The sheet is
          what a thumb hits; this is what a screen reader and a keyboard find,
          and what tells everybody else that pressing is the idea. */}
      <button type="button" className="gl-start-btn" onPointerDown={onStart}>
        Press Start
      </button>

      {/* What the press is about to do. It says "off" for somebody who has
          turned the music off, because a title screen promising sound to a
          manager who asked for silence is worse than saying nothing. */}
      <div className="gl-start-note">{sound ? "Sound on" : "Sound off"}</div>
    </div>
  );
}

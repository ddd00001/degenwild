import { play, setSoundEnabled, useSoundEnabled } from '../sound';

export function SoundToggle() {
  const on = useSoundEnabled();
  const label = on ? 'Game sounds on' : 'Game sounds off';
  return (
    <button
      type="button"
      className={on ? 'sound-toggle on' : 'sound-toggle'}
      aria-pressed={on}
      aria-label={label}
      title={label}
      onClick={() => {
        const next = !on;
        setSoundEnabled(next);
        if (next) play('jpJoin');
      }}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M2 6h2.5L8 3v10L4.5 10H2z" fill="currentColor" />
        {on ? (
          <>
            <path d="M10.5 5.8a3.2 3.2 0 0 1 0 4.4" />
            <path d="M12.3 4a5.6 5.6 0 0 1 0 8" />
          </>
        ) : (
          <>
            <path d="M10.5 6l3.5 4" />
            <path d="M14 6l-3.5 4" />
          </>
        )}
      </svg>
      <span>Sound</span>
    </button>
  );
}

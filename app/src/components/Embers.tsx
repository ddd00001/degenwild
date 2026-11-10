/** Glowing sparks drifting up behind a pop-up. Purely decorative; hidden with reduced motion. */
export function Embers({ count = 14 }: { count?: number }) {
  return (
    <div className="embers" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <i
          key={i}
          style={{
            left: `${(i * 37 + 11) % 100}%`,
            animationDelay: `${(i * 0.53) % 5}s`,
            animationDuration: `${4 + (i % 5)}s`,
          }}
        />
      ))}
    </div>
  );
}

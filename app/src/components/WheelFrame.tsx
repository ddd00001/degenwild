// The jackpot wheel's frame (bezel, hub ring, pointer, shared gradients). One source for the live
// wheel and the replay so they always look the same. Coordinates are the 400x400 wheel viewBox.
import { C, R_IN, R_OUT, polar } from "./JackpotPage";

/** Gradients and filters the wheel uses. Render once inside each wheel's <svg>. */
export function WheelDefs() {
  return (
    <defs>
      <radialGradient
        id="jp-depth"
        gradientUnits="userSpaceOnUse"
        cx={C}
        cy={C}
        r={R_OUT}
      >
        <stop offset={R_IN / R_OUT} stopColor="#000" stopOpacity=".6" />
        <stop offset=".74" stopColor="#000" stopOpacity="0" />
        <stop offset=".93" stopColor="#fff" stopOpacity=".06" />
        <stop offset="1" stopColor="#000" stopOpacity=".45" />
      </radialGradient>
      <pattern
        id="jp-slashes"
        width="9"
        height="9"
        patternUnits="userSpaceOnUse"
        patternTransform="rotate(35)"
      >
        <rect width="2" height="9" fill="#000" fillOpacity=".16" />
      </pattern>
      <linearGradient id="jp-bezel-g" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#5a5a64" />
        <stop offset=".18" stopColor="#24242a" />
        <stop offset=".55" stopColor="#0c0c0f" />
        <stop offset=".85" stopColor="#1c1c22" />
        <stop offset="1" stopColor="#3a3a42" />
      </linearGradient>
      <linearGradient id="jp-fang" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#ff6a70" />
        <stop offset=".5" stopColor="#ff3038" />
        <stop offset="1" stopColor="#7a0a10" />
      </linearGradient>
      <radialGradient id="jp-pivot-g" cx="35%" cy="30%" r="80%">
        <stop offset="0" stopColor="#8a8a94" />
        <stop offset="1" stopColor="#111115" />
      </radialGradient>
      <linearGradient id="jp-gold" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#fff1b8" />
        <stop offset=".5" stopColor="#ffd166" />
        <stop offset="1" stopColor="#d9a12a" />
      </linearGradient>
      <radialGradient id="jp-hub" cx="50%" cy="40%" r="70%">
        <stop offset="0%" stopColor="#2a1012" />
        <stop offset="100%" stopColor="#0c0909" />
      </radialGradient>
      <filter id="jp-glow" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur stdDeviation="6" result="b" />
        <feMerge>
          <feMergeNode in="b" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>
  );
}

/** Machined gunmetal bezel with a red neon line and slots; the pointer sits at the top slot. */
export function WheelBezel() {
  return (
    <>
      {/* bezel: beveled gunmetal ring, a red neon line inside, machined slots around it */}
      <circle cx={C} cy={C} r={R_OUT + 20} className="jp-bezel-edge" />
      <circle
        cx={C}
        cy={C}
        r={R_OUT + 11}
        className="jp-bezel"
        strokeWidth={17}
      />
      {Array.from({ length: 36 }, (_, i) => {
        if (i === 0) return null; // the pointer sits here
        const [x, y] = polar(R_OUT + 11, i * 10);
        return (
          <rect
            key={i}
            x={x - 1.4}
            y={y - (i % 3 === 0 ? 6 : 3.5)}
            width={2.8}
            height={i % 3 === 0 ? 12 : 7}
            rx={1}
            transform={`rotate(${i * 10} ${x} ${y})`}
            className={`jp-slot ${i % 3 === 0 ? "lit" : ""}`}
          />
        );
      })}
      <circle cx={C} cy={C} r={R_OUT + 2.5} className="jp-rim" />
    </>
  );
}

/** The hub disc with its metal ring and neon line (content goes on top). */
export function WheelHub() {
  return (
    <>
      <circle
        cx={C}
        cy={C}
        r={R_IN - 4}
        fill="url(#jp-hub)"
        className="jp-hub"
      />
      <circle cx={C} cy={C} r={R_IN - 1} className="jp-bezel" strokeWidth={7} />
      <circle cx={C} cy={C} r={R_IN - 5.5} className="jp-hub-neon" />
    </>
  );
}

/** The fang-shaped pointer with its pivot cap. */
export function WheelPointer() {
  return (
    <g filter="url(#jp-glow)">
      <path
        d={`M${C - 16} 4 Q${C} -2 ${C + 16} 4 L${C + 5} 24 L${C} 52 L${C - 5} 24 Z`}
        className="jp-pointer fang"
      />
      <path
        d={`M${C - 1.2} 9 L${C + 1.8} 9 L${C} 44 Z`}
        className="jp-pointer-shine"
      />
      <circle cx={C} cy={9} r={6.5} className="jp-pivot" />
    </g>
  );
}

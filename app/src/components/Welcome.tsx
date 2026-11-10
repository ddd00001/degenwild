import { useEffect, useRef, useState } from 'react';
import { Coin } from './Coin';
import { Embers } from './Embers';

const SEEN_KEY = 'dw-welcome-seen';
const SLIDES = 3;
// Slide 2 plays a full demo loop, so it stays up longer.
const AUTO_MS = [6500, 12500, 6500];

/** True on a visitor's first visit (or with ?welcome=1..3, which also picks the starting slide). */
export function shouldShowWelcome(): boolean {
  if (new URLSearchParams(window.location.search).has('welcome')) return true;
  try {
    return localStorage.getItem(SEEN_KEY) !== '1';
  } catch {
    return false; // storage blocked: don't nag on every load
  }
}

function markSeen() {
  try {
    localStorage.setItem(SEEN_KEY, '1');
  } catch {
    /* storage unavailable */
  }
}

/** First-visit intro: three animated slides about the platform. */
export function Welcome({ onClose }: { onClose: () => void }) {
  const forced = Number(new URLSearchParams(window.location.search).get('welcome'));
  const [slide, setSlide] = useState(forced >= 1 && forced <= SLIDES ? forced - 1 : 0);
  const [auto, setAuto] = useState(true);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = dialog.current;
    if (d && !d.open) d.showModal();
  }, []);

  // Auto-advance until the visitor takes over; stop on the last slide.
  useEffect(() => {
    if (!auto || slide >= SLIDES - 1) return;
    const id = window.setTimeout(() => setSlide((s) => s + 1), AUTO_MS[slide]);
    return () => window.clearTimeout(id);
  }, [auto, slide]);

  const close = () => {
    markSeen();
    onClose();
  };
  const go = (n: number) => {
    setAuto(false);
    setSlide(Math.max(0, Math.min(SLIDES - 1, n)));
  };

  return (
    <dialog ref={dialog} className="welcome-dialog" onClose={close} aria-label="Welcome to DegenWild">
      <Embers />
      <button className="match-close" onClick={close} aria-label="Skip intro">
        ×
      </button>

      {/* key restarts the slide's animations each time it's shown */}
      <div className="welcome-slide" key={slide}>
        {slide === 0 && (
          <>
            <div className="welcome-art">
              <img className="welcome-logo" src={`${import.meta.env.BASE_URL}degenwild-logo-t.png`} alt="DegenWild" />
              <div className="chain" aria-hidden="true">
                {['STAKE', 'FLIP', 'PAYOUT'].map((label, i) => (
                  <div className="chain-block" style={{ animationDelay: `${0.5 + i * 0.45}s` }} key={label}>
                    <span className="chain-check">✓</span>
                    {label}
                  </div>
                ))}
              </div>
            </div>
            <div className="welcome-kicker">WELCOME TO DEGENWILD</div>
            <h2>
              The first <em>100% on-chain</em> Solana PvP arena
            </h2>
            <p>Every stake, every flip and every payout is a Solana transaction anyone can check. No house. No hidden server.</p>
          </>
        )}

        {slide === 1 && (
          <>
            <div className="welcome-art">
              <DemoReel />
            </div>
            <div className="welcome-kicker">COINFLIP BATTLES</div>
            <h2>
              Call your flip. <em>Beat a real player.</em>
            </h2>
            <p>Join an open battle from the lobby or create your own. The coin flips live and the winner takes the pot.</p>
          </>
        )}

        {slide === 2 && (
          <>
            <div className="welcome-art">
              <ul className="feature-grid">
                {[
                  ['🔒', 'On-chain escrow', 'Stakes are locked by the program, not by us'],
                  ['🎲', 'Provably fair', 'Nobody can pick the result'],
                  ['⚡', 'Auto payouts', 'Winnings sent in seconds'],
                  ['🔥', 'Double Down', 'Win and go again in one tap'],
                ].map(([icon, title, text], i) => (
                  <li style={{ animationDelay: `${0.15 + i * 0.18}s` }} key={title}>
                    <span aria-hidden="true">{icon}</span>
                    <div>
                      <b>{title}</b>
                      <small>{text}</small>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
            <div className="welcome-kicker">BUILT FOR DEGENS</div>
            <h2>
              Fair by design. <em>Paid in seconds.</em>
            </h2>
            <p>Connect your wallet, pick a name and start your first battle.</p>
          </>
        )}
      </div>

      <div className="welcome-footer">
        <div className="welcome-dots" role="tablist" aria-label="Slides">
          {Array.from({ length: SLIDES }, (_, i) => (
            <button
              key={i}
              role="tab"
              aria-selected={i === slide}
              aria-label={`Slide ${i + 1} of ${SLIDES}`}
              className={i === slide ? 'active' : ''}
              onClick={() => go(i)}
            />
          ))}
        </div>
        {slide < SLIDES - 1 ? (
          <button className="primary-btn welcome-next" onClick={() => go(slide + 1)}>
            Next →
          </button>
        ) : (
          <button className="primary-btn welcome-next" onClick={close}>
            Start playing
          </button>
        )}
      </div>
    </dialog>
  );
}

// ---------------------------------------------------------------- demo reel

// One loop of the scripted "recording": [stage, how long it stays].
const REEL: [stage: string, ms: number][] = [
  ['lobby', 1100], // lobby with open battles
  ['move', 1000], // cursor glides to Join
  ['click', 700], // click + ripple, row lights up
  ['match', 1000], // MATCH FOUND face-off
  ['c3', 600],
  ['c2', 600],
  ['c1', 600],
  ['flip', 2100], // coin spins and lands
  ['win', 2600], // YOU WON + coin burst
];
const DEMO_ROWS = [
  { name: 'solking', side: 1 as const, stake: '0.50' },
  { name: 'flipqueen', side: 0 as const, stake: '0.10' },
  { name: 'moonboi', side: 1 as const, stake: '1.00' },
];

/** A looping, scripted mock of joining an open battle from the lobby. Purely illustrative. */
function DemoReel() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = window.setTimeout(() => setI((n) => (n + 1) % REEL.length), REEL[i][1]);
    return () => window.clearTimeout(id);
  }, [i]);
  const stage = REEL[i][0];
  const inLobby = stage === 'lobby' || stage === 'move' || stage === 'click';
  const count = stage === 'c3' ? 3 : stage === 'c2' ? 2 : stage === 'c1' ? 1 : null;
  const flipping = stage === 'flip' || stage === 'win';
  // The coin mounts at 0° and is told to spin a frame later, so the transition actually runs.
  const [spun, setSpun] = useState(false);
  useEffect(() => {
    if (!flipping) return setSpun(false);
    let inner = 0;
    const outer = requestAnimationFrame(() => (inner = requestAnimationFrame(() => setSpun(true))));
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [flipping]);

  return (
    <div className={`reel stage-${stage}`} aria-hidden="true">
      <span className="reel-rec">
        <i /> DEMO
      </span>
      {inLobby ? (
        <div className="reel-lobby">
          <div className="reel-title">OPEN BATTLES</div>
          {DEMO_ROWS.map((r, n) => (
            <div className={`reel-row ${n === 1 ? 'target' : ''}`} key={r.name}>
              <span className="reel-coin">
                <Coin side={r.side} />
              </span>
              <b>{r.name}</b>
              <small>{r.stake} SOL</small>
              <span className="reel-join">{n === 1 && stage === 'click' ? 'Joined ✓' : `Join ${r.side ? 'heads' : 'tails'}`}</span>
            </div>
          ))}
          <svg className="reel-cursor" viewBox="0 0 24 24" width="22" height="22">
            <path d="M4 2 L4 19 L8.5 15 L11.5 22 L14.5 20.7 L11.6 14 L18 14 Z" fill="#fff" stroke="#000" strokeWidth="1.3" strokeLinejoin="round" />
          </svg>
        </div>
      ) : (
        <div className="reel-match">
          <div className="reel-title">{stage === 'win' ? 'RESULT' : 'MATCH FOUND'} · 0.20 SOL POT</div>
          <div className="reel-versus">
            <div className={`reel-player ${stage === 'win' ? 'lost' : ''}`}>
              <span className="reel-coin big">
                <Coin side={0} />
              </span>
              <b>flipqueen</b>
            </div>
            <div className="reel-stage">
              {count !== null ? (
                <span className="reel-count" key={count}>
                  {count}
                </span>
              ) : (
                <div className="coin3d-wrap reel-flip">
                  <div
                    className="coin3d"
                    style={{
                      transform: `rotateY(${spun ? 360 * 5 + 180 : 0}deg)`,
                      transition: spun ? 'transform 2000ms cubic-bezier(.15,.7,.2,1)' : 'none',
                    }}
                  >
                    <div className="coin-face heads">
                      <Coin side={0} detailed />
                    </div>
                    <div className="coin-face tails">
                      <Coin side={1} detailed />
                    </div>
                  </div>
                  {stage === 'win' && (
                    <div className="burst">
                      {Array.from({ length: 12 }, (_, n) => (
                        <i key={n} style={{ ['--a' as string]: `${n * 30}deg` }} />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className={`reel-player ${stage === 'win' ? 'won' : ''}`}>
              <span className="reel-coin big">
                <Coin side={1} />
              </span>
              <b>You</b>
            </div>
          </div>
          <div className="reel-result">{stage === 'win' ? 'YOU WON 0.193 SOL' : stage === 'flip' ? 'Flipping…' : '\u00a0'}</div>
        </div>
      )}
    </div>
  );
}

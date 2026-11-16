// Smooth list reordering without a library ("FLIP": measure, invert, play).
// Children of the container need a `data-key`. Rows that appear after the first render get the
// `row-enter` class once, so a refresh that changes nothing never replays an entrance.
import { type RefObject, useLayoutEffect, useRef } from 'react';

const reduced = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function useFlipList(container: RefObject<HTMLElement | null>, keys: readonly string[]) {
  const last = useRef(new Map<string, DOMRect>());
  const seen = useRef<Set<string> | null>(null);
  const sig = keys.join('|');

  useLayoutEffect(() => {
    const el = container.current;
    if (!el) return;
    const rows = Array.from(el.querySelectorAll<HTMLElement>(':scope > [data-key]'));
    const next = new Map<string, DOMRect>();
    const firstRender = seen.current === null;
    seen.current ??= new Set();
    for (const row of rows) {
      const key = row.dataset.key!;
      const now = row.getBoundingClientRect();
      next.set(key, now);
      const before = last.current.get(key);
      if (!firstRender && !seen.current.has(key)) {
        row.classList.remove('row-enter');
        void row.offsetWidth; // restart the animation if the class was there
        row.classList.add('row-enter');
      } else if (before && !reduced()) {
        const dy = before.top - now.top;
        if (Math.abs(dy) > 1) {
          row.animate([{ transform: `translateY(${dy}px)` }, { transform: 'translateY(0)' }], {
            duration: 420,
            easing: 'cubic-bezier(.2,.8,.2,1)',
          });
        }
      }
      seen.current.add(key);
    }
    last.current = next;
  }, [container, sig]);
}

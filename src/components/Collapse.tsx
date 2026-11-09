import { type ReactNode, useEffect, useRef, useState } from 'react';

/** How long the slide takes; matches .collapse in styles.css (the fallback waits a little longer). */
export const COLLAPSE_MS = 200;

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/**
 * Slides its children open and shut (a grid row going 0fr ↔ 1fr, so no height
 * is measured). They mount when it opens and unmount once it has shut, so what's
 * inside (an autofocused search box, a form's draft) starts fresh each time.
 * Instant under prefers-reduced-motion.
 */
export default function Collapse({ open, children }: { open: boolean; children: ReactNode }) {
  const [mounted, setMounted] = useState(open);
  const [expanded, setExpanded] = useState(open);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setMounted(true);
      if (reducedMotion()) {
        setExpanded(true);
        return;
      }
      // mount shut first, then open on a later frame, so the row has something to grow from
      let second = 0;
      const first = requestAnimationFrame(() => {
        second = requestAnimationFrame(() => setExpanded(true));
      });
      return () => {
        cancelAnimationFrame(first);
        cancelAnimationFrame(second);
      };
    }
    setExpanded(false);
    if (reducedMotion()) {
      setMounted(false);
      return;
    }
    // unmount when the slide ends (or soon after, if no transitionend arrives)
    const timer = window.setTimeout(() => setMounted(false), COLLAPSE_MS + 100);
    return () => window.clearTimeout(timer);
  }, [open]);

  if (!mounted) return null;
  return (
    <div
      ref={box}
      className={expanded ? 'collapse open' : 'collapse'}
      onTransitionEnd={(e) => {
        if (e.target === box.current && !open) setMounted(false);
      }}
    >
      <div className="collapse-inner">{children}</div>
    </div>
  );
}

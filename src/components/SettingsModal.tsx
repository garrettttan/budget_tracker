import { type ReactNode, useEffect, useRef } from 'react';
import Button from './Button';
import Modal from './Modal';

/**
 * What a Settings row (components/SettingsRow.tsx) opens: a wide modal holding that section's list.
 * It sits near the top (so the search box never moves) and animates its height when the list
 * grows or shrinks, e.g. while searching, instead of jumping.
 */
export default function SettingsModal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const id = `settings-${title.toLowerCase()}-title`;
  const body = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const content = body.current;
    const dialog = content?.closest('dialog');
    if (!content || !dialog || typeof ResizeObserver === 'undefined') return;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const css = getComputedStyle(dialog);
    const chrome = ['paddingTop', 'paddingBottom', 'borderTopWidth', 'borderBottomWidth'].reduce(
      (n, k) => n + parseFloat(css[k as 'paddingTop']),
      0,
    );
    let first = true;
    let timer = 0;
    // the dialog gets an explicit height (height: auto can't be animated); max-height still caps it
    const observer = new ResizeObserver(() => {
      const target = `${content.offsetHeight + chrome}px`;
      if (dialog.style.height === target) return;
      if (first || still) {
        first = false;
        dialog.style.height = target;
        return;
      }
      // no scrollbar flashing mid-animation; a timer, not transitionend, since a modal already at its
      // max height doesn't visibly change and fires no transition
      dialog.classList.add('resizing');
      dialog.style.height = target;
      clearTimeout(timer);
      timer = window.setTimeout(() => dialog.classList.remove('resizing'), 250);
    });
    observer.observe(content);
    return () => {
      observer.disconnect();
      clearTimeout(timer);
    };
  }, []);

  return (
    <Modal labelledBy={id} onClose={onClose} className="modal-wide settings-modal">
      {(close) => (
        <div ref={body}>
          <div className="modal-head settings-modal-head">
            <h2 id={id}>{title}</h2>
            <Button variant="icon" aria-label="Close" onClick={close}>
              ×
            </Button>
          </div>
          {children}
        </div>
      )}
    </Modal>
  );
}

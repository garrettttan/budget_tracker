import { type ReactNode, useEffect, useRef } from 'react';

/**
 * A modal on the native <dialog>: showModal gives the backdrop, focus trap and
 * Esc to close. Esc and backdrop clicks are ignored while `busy` (mid-save).
 * Children get `close`, so a Cancel button closes through the dialog and
 * `onClose` fires once however it was closed.
 */
export default function Modal({
  labelledBy,
  busy = false,
  onClose,
  className,
  children,
}: {
  labelledBy: string; // id of the modal's heading
  busy?: boolean;
  onClose: () => void;
  /** extra class, e.g. modal-wide for a chart */
  className?: string;
  children: (close: () => void) => ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  const close = () => dialog.current?.close();

  return (
    <dialog
      ref={dialog}
      className={className ? `modal ${className}` : 'modal'}
      aria-labelledby={labelledBy}
      onClose={onClose}
      onCancel={(e) => busy && e.preventDefault()}
      // a click on the backdrop lands on the dialog element itself
      onClick={(e) => {
        if (e.target === dialog.current && !busy) close();
      }}
    >
      {children(close)}
    </dialog>
  );
}

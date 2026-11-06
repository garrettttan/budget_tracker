import type { ReactNode } from 'react';
import Button from './Button';
import Modal from './Modal';

/** What a Settings row (components/SettingsRow.tsx) opens: a wide modal holding that section's list. */
export default function SettingsModal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const id = `settings-${title.toLowerCase()}-title`;
  return (
    <Modal labelledBy={id} onClose={onClose} className="modal-wide">
      {(close) => (
        <>
          <div className="modal-head settings-modal-head">
            <h2 id={id}>{title}</h2>
            <Button variant="icon" aria-label="Close" onClick={close}>
              ×
            </Button>
          </div>
          {children}
        </>
      )}
    </Modal>
  );
}

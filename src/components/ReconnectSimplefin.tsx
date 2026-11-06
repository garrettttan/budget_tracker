import { useState } from 'react';
import Button from './Button';
import ConnectSimplefin from './ConnectSimplefin';
import Modal from './Modal';

/** Settings → Reconnect: a new Setup Token in a modal. Closes on success; onConnected gets the result. */
export default function ReconnectSimplefin({
  onConnected,
  onClose,
}: {
  onConnected: (message: string) => void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal labelledBy="reconnect-title" busy={busy} onClose={onClose}>
      {(close) => (
        <>
          <div className="modal-head">
            <h2 id="reconnect-title">Reconnect SimpleFIN</h2>
            <Button variant="icon" aria-label="Close" disabled={busy} title={busy ? 'Wait for the connection to finish' : undefined} onClick={close}>
              ×
            </Button>
          </div>
          <ConnectSimplefin
            onBusyChange={setBusy}
            onConnected={(message) => {
              onConnected(message);
              close();
            }}
          />
        </>
      )}
    </Modal>
  );
}

import { useState } from 'react';
import Button from './Button';
import ConnectSimplefin from './ConnectSimplefin';
import Modal from './Modal';
import { strings } from '../lib/strings';

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
            <h2 id="reconnect-title">{strings.settings.reconnectTitle}</h2>
            <Button
              variant="icon"
              aria-label={strings.common.close}
              disabled={busy}
              title={busy ? strings.settings.waitForConnection : undefined}
              onClick={close}
            >
              {strings.common.closeSymbol}
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

import Button from './Button';
import MerchantList from './MerchantList';
import Modal from './Modal';

/** Settings → Merchants → Manage: the merchant table (search, rename, merge) in a modal. */
export default function MerchantsModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal labelledBy="merchants-title" onClose={onClose} className="modal-wide">
      {(close) => (
        <>
          <div className="modal-head">
            <h2 id="merchants-title">Merchants</h2>
            <Button variant="icon" aria-label="Close" onClick={close}>
              ×
            </Button>
          </div>
          <MerchantList />
        </>
      )}
    </Modal>
  );
}

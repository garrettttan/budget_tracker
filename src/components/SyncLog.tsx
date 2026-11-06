import { relativeTime } from '../lib/format';
import Button from './Button';
import Modal from './Modal';

export type SyncRun = {
  id: string;
  trigger: string;
  started_at: string;
  status: string;
  new_count: number;
  updated_count: number;
  removed_count: number;
  messages: string[];
};

/** The last runs of the daily sync, in a modal opened from Settings → Bank connection. */
export default function SyncLog({ runs, onClose }: { runs: SyncRun[]; onClose: () => void }) {
  return (
    <Modal labelledBy="sync-log-title" onClose={onClose} className="modal-wide">
      {(close) => (
        <>
          <div className="modal-head">
            <h2 id="sync-log-title">Sync log</h2>
            <Button variant="icon" aria-label="Close" onClick={close}>
              ×
            </Button>
          </div>
          <SyncTable runs={runs} />
        </>
      )}
    </Modal>
  );
}

function SyncTable({ runs }: { runs: SyncRun[] }) {
  return (
    <table className="register">
      <thead>
        <tr>
          <th scope="col">When</th>
          <th scope="col">Result</th>
          <th scope="col" className="num">New</th>
          <th scope="col" className="num">Updated</th>
          <th scope="col" className="num">Removed</th>
        </tr>
      </thead>
      <tbody>
        {runs.map((run) => (
          <tr key={run.id}>
            <td>
              {relativeTime(run.started_at)}
              {run.trigger !== 'schedule' && <span className="muted"> ({run.trigger})</span>}
            </td>
            <td className={run.status === 'error' ? 'error' : undefined}>
              {run.status}
              {run.messages.length > 0 && <div className="muted small">{run.messages.join(' ')}</div>}
            </td>
            <td className="num">{run.new_count}</td>
            <td className="num">{run.updated_count}</td>
            <td className="num">{run.removed_count}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

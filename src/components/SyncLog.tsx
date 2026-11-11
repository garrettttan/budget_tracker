import { relativeTime } from '../lib/format';
import Button from './Button';
import Modal from './Modal';
import { strings } from '../lib/strings';

const t = strings.settings;

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
            <h2 id="sync-log-title">{t.syncLog}</h2>
            <Button variant="icon" aria-label={strings.common.close} onClick={close}>
              {strings.common.closeSymbol}
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
    <table className="register sync-log">
      <thead>
        <tr>
          <th scope="col">{t.when}</th>
          <th scope="col">{t.result}</th>
          <th scope="col" className="num">{t.new}</th>
          <th scope="col" className="num">{t.updated}</th>
          <th scope="col" className="num">{t.removed}</th>
        </tr>
      </thead>
      <tbody>
        {runs.map((run) => (
          <tr key={run.id}>
            <td>
              {relativeTime(run.started_at)}
              {run.trigger !== 'schedule' && <span className="muted sync-trigger">{t.trigger(run.trigger)}</span>}
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

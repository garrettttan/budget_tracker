import { relativeTime } from '../lib/format';

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

export default function SyncLog({ runs }: { runs: SyncRun[] }) {
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

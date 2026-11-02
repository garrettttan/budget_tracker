import { Link } from 'react-router-dom';

export default function Review({ count }: { count: number | null }) {
  return (
    <section>
      <header className="page-head">
        <h1>Review</h1>
      </header>
      <div className="tally">
        <span className="tally-number">{count ?? '–'}</span>
        <span className="tally-label">{count === 1 ? 'transaction to review' : 'transactions to review'}</span>
      </div>
      {count === 0 && (
        <p className="empty">
          Nothing waiting. Once your banks are connected on the{' '}
          <Link to="/accounts">Accounts</Link> page, each new transaction lands here until you
          approve it.
        </p>
      )}
    </section>
  );
}

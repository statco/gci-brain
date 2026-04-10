import { useState, useEffect } from 'react';

const STARS = [1, 2, 3, 4, 5];

function StarRating({ rating }) {
  return (
    <span style={{ color: '#B8192E', fontSize: 16, letterSpacing: 1 }}>
      {STARS.map(i => (i <= rating ? '★' : '☆')).join('')}
    </span>
  );
}

function ReviewRow({ review, token, onAction }) {
  const [loading, setLoading] = useState(false);

  async function act(action) {
    if (!token) return alert('Enter your admin token first.');
    setLoading(true);
    try {
      const r = await fetch('/api/reviews/moderate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ reviewId: review.id, action }),
      });
      const d = await r.json();
      if (d.success) onAction(review.id, action);
      else alert(d.message ?? 'Error');
    } catch (e) {
      alert(String(e));
    } finally {
      setLoading(false);
    }
  }

  const excerpt = String(review.body ?? '').slice(0, 120);
  const hasMore = String(review.body ?? '').length > 120;

  return (
    <tr style={s.tr}>
      <td style={s.td}>
        <span style={s.productTitle}>{String(review.productTitle ?? review.productHandle ?? '—')}</span>
      </td>
      <td style={s.td}>
        <span style={s.reviewer}>{String(review.reviewerName ?? '—')}</span>
      </td>
      <td style={{ ...s.td, textAlign: 'center' }}>
        <StarRating rating={Number(review.rating ?? 0)} />
        <div style={s.ratingNum}>{review.rating}/5</div>
      </td>
      <td style={s.td}>
        {review.title && (
          <div style={s.reviewTitle}>{String(review.title)}</div>
        )}
        <div style={s.excerpt}>
          {excerpt}{hasMore ? '…' : ''}
        </div>
        <div style={s.meta}>
          <span style={s.langBadge}>{String(review.language ?? 'EN')}</span>
          {review.submittedAt && (
            <span style={s.dateText}>{String(review.submittedAt)}</span>
          )}
        </div>
      </td>
      <td style={{ ...s.td, whiteSpace: 'nowrap' }}>
        <button
          style={{ ...s.btn, ...s.btnApprove, opacity: loading ? 0.5 : 1 }}
          onClick={() => act('approve')}
          disabled={loading}
        >
          ✓ Approve
        </button>
        <button
          style={{ ...s.btn, ...s.btnReject, opacity: loading ? 0.5 : 1, marginTop: 6 }}
          onClick={() => act('reject')}
          disabled={loading}
        >
          ✗ Reject
        </button>
      </td>
    </tr>
  );
}

export default function ReviewsModeration() {
  const [token, setToken] = useState('');
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [counts, setCounts] = useState({ pending: 0, approved: 0, rejected: 0 });

  async function load() {
    setLoading(true);
    setError('');
    try {
      const r = await fetch('/api/reviews/pending-count', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      const pending = d.reviews ?? [];
      setReviews(pending);
      setCounts(prev => ({ ...prev, pending: pending.length }));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function handleAction(id, action) {
    setReviews(prev => prev.filter(r => r.id !== id));
    setCounts(prev => ({
      ...prev,
      pending: Math.max(0, prev.pending - 1),
      approved: action === 'approve' ? prev.approved + 1 : prev.approved,
      rejected: action === 'reject' ? prev.rejected + 1 : prev.rejected,
    }));
  }

  return (
    <div style={s.root}>
      {/* Header */}
      <header style={s.header}>
        <div style={s.headerLeft}>
          <span style={s.logo}>⚙ GCI BRAIN</span>
          <span style={s.headerSep}>—</span>
          <span style={s.pageTitle}>Customer Reviews</span>
        </div>
        <a href="/brain" style={s.backLink}>← Dashboard</a>
      </header>

      <main style={s.main}>
        {/* Token input */}
        <div style={s.tokenRow}>
          <label style={s.tokenLabel}>ADMIN TOKEN</label>
          <input
            type="password"
            value={token}
            onChange={e => setToken(e.target.value)}
            placeholder="Bearer token for /api/reviews/moderate"
            style={s.tokenInput}
          />
          <button style={s.loadBtn} onClick={load} disabled={loading}>
            {loading ? 'Loading…' : '↻ Load'}
          </button>
        </div>

        {/* Counters */}
        <div style={s.counters}>
          <div style={{ ...s.counter, borderColor: '#facc15' }}>
            <div style={{ ...s.counterNum, color: counts.pending > 0 ? '#facc15' : '#4ade80' }}>
              {counts.pending}
            </div>
            <div style={s.counterLabel}>PENDING</div>
          </div>
          <div style={{ ...s.counter, borderColor: '#4ade80' }}>
            <div style={{ ...s.counterNum, color: '#4ade80' }}>{counts.approved}</div>
            <div style={s.counterLabel}>APPROVED</div>
          </div>
          <div style={{ ...s.counter, borderColor: '#f87171' }}>
            <div style={{ ...s.counterNum, color: '#f87171' }}>{counts.rejected}</div>
            <div style={s.counterLabel}>REJECTED</div>
          </div>
        </div>

        {/* Error */}
        {error && <div style={s.errorBox}>{error}</div>}

        {/* Table */}
        {!loading && reviews.length === 0 && !error && (
          <div style={s.empty}>No pending reviews.</div>
        )}

        {reviews.length > 0 && (
          <div style={s.tableWrap}>
            <table style={s.table}>
              <thead>
                <tr>
                  {['Product', 'Reviewer', 'Rating', 'Review', 'Actions'].map(h => (
                    <th key={h} style={s.th}>{h.toUpperCase()}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {reviews.map(r => (
                  <ReviewRow
                    key={r.id}
                    review={r}
                    token={token}
                    onAction={handleAction}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}

const s = {
  root: {
    minHeight: '100vh',
    background: '#1a1f2e',
    color: '#e8e8e8',
    fontFamily: "'Courier New', monospace",
    display: 'flex',
    flexDirection: 'column',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '14px 28px',
    borderBottom: '1px solid #2a3040',
    background: '#141824',
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
  },
  logo: {
    fontSize: 16,
    fontWeight: 700,
    letterSpacing: '0.12em',
    color: '#B8192E',
  },
  headerSep: {
    color: '#444',
    fontSize: 14,
  },
  pageTitle: {
    fontSize: 14,
    color: '#ccc',
    letterSpacing: '0.06em',
  },
  backLink: {
    fontSize: 12,
    color: '#888',
    textDecoration: 'none',
    letterSpacing: '0.06em',
  },
  main: {
    flex: 1,
    padding: '28px 32px',
    maxWidth: 1100,
    width: '100%',
    margin: '0 auto',
    boxSizing: 'border-box',
  },
  tokenRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    marginBottom: 24,
  },
  tokenLabel: {
    fontSize: 10,
    color: '#666',
    letterSpacing: '0.14em',
    whiteSpace: 'nowrap',
  },
  tokenInput: {
    flex: 1,
    background: '#141824',
    border: '1px solid #2a3040',
    borderRadius: 3,
    color: '#e8e8e8',
    fontFamily: "'Courier New', monospace",
    fontSize: 13,
    padding: '8px 12px',
    outline: 'none',
  },
  loadBtn: {
    background: 'transparent',
    border: '1px solid #B8192E',
    color: '#B8192E',
    fontFamily: "'Courier New', monospace",
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: '0.1em',
    padding: '8px 16px',
    borderRadius: 2,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  counters: {
    display: 'flex',
    gap: 16,
    marginBottom: 24,
  },
  counter: {
    background: '#141824',
    border: '1px solid',
    borderRadius: 4,
    padding: '14px 20px',
    minWidth: 100,
  },
  counterNum: {
    fontFamily: 'Georgia, serif',
    fontSize: 28,
    fontWeight: 700,
    lineHeight: 1,
  },
  counterLabel: {
    fontSize: 10,
    color: '#888',
    letterSpacing: '0.14em',
    marginTop: 6,
  },
  errorBox: {
    background: '#2a1020',
    border: '1px solid #7f1d1d',
    borderRadius: 4,
    color: '#f87171',
    fontSize: 12,
    padding: '10px 14px',
    marginBottom: 16,
  },
  empty: {
    color: '#555',
    fontSize: 13,
    textAlign: 'center',
    padding: '60px 0',
    letterSpacing: '0.06em',
  },
  tableWrap: {
    overflowX: 'auto',
    border: '1px solid #2a3040',
    borderRadius: 4,
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: 13,
  },
  th: {
    background: '#141824',
    color: '#B8192E',
    fontFamily: "'Courier New', monospace",
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: '0.14em',
    padding: '10px 14px',
    textAlign: 'left',
    borderBottom: '1px solid #2a3040',
    whiteSpace: 'nowrap',
  },
  tr: {
    borderBottom: '1px solid #1e2434',
  },
  td: {
    padding: '14px',
    verticalAlign: 'top',
    color: '#ccc',
  },
  productTitle: {
    fontFamily: 'Georgia, serif',
    fontSize: 13,
    color: '#e8e8e8',
    display: 'block',
    maxWidth: 180,
  },
  reviewer: {
    fontSize: 13,
    color: '#bbb',
  },
  ratingNum: {
    fontSize: 10,
    color: '#666',
    marginTop: 2,
    textAlign: 'center',
  },
  reviewTitle: {
    fontFamily: 'Georgia, serif',
    fontSize: 13,
    fontWeight: 700,
    color: '#e8e8e8',
    marginBottom: 4,
  },
  excerpt: {
    fontSize: 12,
    color: '#999',
    lineHeight: 1.6,
    maxWidth: 360,
  },
  meta: {
    display: 'flex',
    gap: 8,
    marginTop: 6,
    alignItems: 'center',
  },
  langBadge: {
    fontSize: 10,
    color: '#555',
    border: '1px solid #2a3040',
    padding: '1px 5px',
    borderRadius: 2,
    letterSpacing: '0.08em',
  },
  dateText: {
    fontSize: 10,
    color: '#555',
  },
  btn: {
    display: 'block',
    width: '100%',
    fontFamily: "'Courier New', monospace",
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '0.1em',
    padding: '6px 12px',
    border: 'none',
    borderRadius: 2,
    cursor: 'pointer',
    transition: 'opacity 150ms',
  },
  btnApprove: {
    background: '#166534',
    color: '#fff',
  },
  btnReject: {
    background: '#7f1d1d',
    color: '#fff',
  },
};

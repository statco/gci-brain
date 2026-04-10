import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import TranslateContentCard from './TranslateContentCard';

const catalogTools = [
  {
    icon: '🔧',
    title: 'Shopify Fix',
    route: '/shopify-fix',
    description: 'Fix size format, variants, image assignment & SEO translation',
  },
  {
    icon: '📝',
    title: 'Fix Descriptions',
    route: '/fix-descriptions',
    description: 'Translate French product descriptions to English',
  },
  {
    icon: '🖼',
    title: 'Fix Alt Tags',
    route: '/fix-alt-tags',
    description: 'Translate French image alt tags across all products',
  },
  {
    icon: '🔍',
    title: 'Fix French Content',
    route: '/fix-french',
    description: 'Audit & fix French in pages, collections, policies',
  },
  {
    icon: '🗂',
    title: 'Update Collection SEO',
    route: '/collection-seo',
    description: 'Update SEO titles & descriptions for all 11 collections',
  },
  {
    icon: '🎨',
    title: 'Fix Theme Content',
    route: '/fix-theme',
    description: 'Fix footer legal line and menu labels',
  },
  {
    icon: '🔀',
    title: 'Fix Redirects',
    route: '/fix-redirects',
    description: 'Create 301 redirects for all archived duplicate product URLs',
  },
  {
    icon: '🔤',
    title: 'Fix Titles',
    route: '/fix-titles',
    description: 'Convert ALL CAPS product titles to Title Case',
  },
];

const storeTools = [
  {
    icon: '🤖',
    title: 'GCI AI Match 2.0',
    url: 'https://match.gcitires.com',
    description: 'AI-powered tire fitment engine',
  },
  {
    icon: '💬',
    title: 'TireBot',
    url: 'https://gcitires.com',
    description: 'Bilingual AI chat assistant',
  },
  {
    icon: '🏪',
    title: 'Shopify Admin',
    url: 'https://gcitires.myshopify.com/admin',
    description: 'Store backend',
  },
  {
    icon: '📊',
    title: 'Vercel Dashboard',
    url: 'https://vercel.com/dashboard',
    description: 'Deployments & logs',
  },
  {
    icon: '📦',
    title: 'GitHub Repo',
    url: 'https://github.com/statco/gci-brain',
    description: 'Source code',
  },
];

// ─── TIRE SIZE FIX CARD ───────────────────────────────────────────────────────

function TireSizeFixCard() {
  const [status, setStatus]         = useState('idle'); // 'idle'|'running'|'done'|'error'
  const [progress, setProgress]     = useState({ fixed: 0, skipped: 0, total: 0 });
  const [errors, setErrors]         = useState([]);
  const [previewItems, setPreview]  = useState([]);

  const run = async (preview = false) => {
    setStatus('running');
    setProgress({ fixed: 0, skipped: 0, total: 0 });
    setErrors([]);
    setPreview([]);

    let cursor      = 0;
    let totalFixed  = 0;
    let totalSkipped = 0;
    let allErrors   = [];
    let allPreview  = [];

    try {
      while (true) {
        const url = `/api/fixTireSize?cursor=${cursor}${preview ? '&preview=true' : ''}`;
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`Server error ${resp.status}`);
        const data = await resp.json();

        totalFixed   += data.fixed   ?? 0;
        totalSkipped += data.skipped ?? 0;
        allErrors     = [...allErrors, ...(data.errors ?? [])];
        if (allPreview.length < 20) {
          allPreview = [...allPreview, ...(data.preview ?? [])].slice(0, 20);
        }

        setProgress({ fixed: totalFixed, skipped: totalSkipped, total: data.total ?? 0 });
        setPreview([...allPreview]);

        if (data.nextCursor == null) break;
        cursor = data.nextCursor;
      }

      setErrors(allErrors);
      setStatus('done');
    } catch (err) {
      setErrors(prev => [...prev, String(err)]);
      setStatus('error');
    }
  };

  const isRunning = status === 'running';

  return (
    <div style={tsfc.card} className="dash-card">
      {/* Header row */}
      <div style={tsfc.top}>
        <div style={tsfc.titleRow}>
          <span style={styles.cardIcon}>📐</span>
          <h3 style={styles.cardTitle}>Run Tire Size Fix</h3>
        </div>
        <span style={isRunning ? tsfc.badgeRunning : status === 'done' ? tsfc.badgeDone : tsfc.badgeIdle}>
          {isRunning ? '⟳ RUNNING' : status === 'done' ? '✓ DONE' : status === 'error' ? '✗ ERROR' : '● READY'}
        </span>
      </div>

      <p style={styles.cardDesc}>
        Fix malformed size codes in product titles (2154517/r → 215/45R17). Runs in 50-product chunks.
      </p>

      {/* Progress bar */}
      {(isRunning || status === 'done' || status === 'error') && (
        <div style={tsfc.progressWrap}>
          <div style={tsfc.progressLabel}>
            {isRunning
              ? `Fixed ${progress.fixed} / ${progress.total} — ${progress.skipped} skipped…`
              : `Fixed ${progress.fixed} / ${progress.total} — ${progress.skipped} skipped${errors.length ? ` — ${errors.length} error(s)` : ''}`
            }
          </div>
          {progress.total > 0 && (
            <div style={tsfc.barTrack}>
              <div style={{ ...tsfc.barFill, width: `${Math.round(((progress.fixed + progress.skipped) / progress.total) * 100)}%` }} />
            </div>
          )}
        </div>
      )}

      {/* Buttons */}
      <div style={tsfc.btnRow}>
        <button
          style={{ ...tsfc.btn, ...tsfc.btnSecondary, ...(isRunning ? tsfc.btnDisabled : {}) }}
          onClick={() => run(true)}
          disabled={isRunning}
        >
          PREVIEW
        </button>
        <button
          style={{ ...tsfc.btn, ...tsfc.btnPrimary, ...(isRunning ? tsfc.btnDisabled : {}) }}
          onClick={() => run(false)}
          disabled={isRunning}
        >
          {isRunning ? 'RUNNING…' : 'RUN ALL'}
        </button>
      </div>

      {/* Preview table (first 20 changes) */}
      {previewItems.length > 0 && (
        <div style={tsfc.previewWrap}>
          <div style={tsfc.previewHeading}>PREVIEW — first {previewItems.length} changes</div>
          <div style={tsfc.previewList}>
            {previewItems.map((item, i) => (
              <div key={i} style={tsfc.previewRow}>
                <span style={tsfc.previewBefore}>{item.before}</span>
                <span style={tsfc.previewArrow}>→</span>
                <span style={tsfc.previewAfter}>{item.after}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Errors */}
      {errors.length > 0 && (
        <div style={tsfc.errorList}>
          {errors.map((e, i) => <div key={i} style={tsfc.errorItem}>⚠ {e}</div>)}
        </div>
      )}
    </div>
  );
}

// Styles scoped to TireSizeFixCard
const tsfc = {
  card: {
    background: '#12121a',
    border: '1px solid #2a2a3a',
    borderRadius: '4px',
    padding: '20px',
    display: 'flex',
    flexDirection: 'column',
    gap: '14px',
  },
  top: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  titleRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  },
  badgeIdle: {
    fontFamily: "'Courier New', monospace",
    fontSize: '11px',
    color: '#888',
    letterSpacing: '0.1em',
  },
  badgeRunning: {
    fontFamily: "'Courier New', monospace",
    fontSize: '11px',
    color: '#facc15',
    letterSpacing: '0.1em',
  },
  badgeDone: {
    fontFamily: "'Courier New', monospace",
    fontSize: '11px',
    color: '#4ade80',
    letterSpacing: '0.1em',
  },
  progressWrap: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  progressLabel: {
    fontFamily: "'Courier New', monospace",
    fontSize: '12px',
    color: '#aaa',
  },
  barTrack: {
    height: '4px',
    background: '#2a2a3a',
    borderRadius: '2px',
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    background: '#ff3c00',
    borderRadius: '2px',
    transition: 'width 300ms ease',
  },
  btnRow: {
    display: 'flex',
    gap: '10px',
  },
  btn: {
    fontFamily: "'Courier New', monospace",
    fontSize: '12px',
    fontWeight: 700,
    letterSpacing: '0.12em',
    padding: '8px 18px',
    borderRadius: '2px',
    cursor: 'pointer',
    border: 'none',
    transition: 'background 200ms, color 200ms, opacity 200ms',
  },
  btnPrimary: {
    background: '#ff3c00',
    color: '#fff',
  },
  btnSecondary: {
    background: 'transparent',
    border: '1px solid #ff3c00',
    color: '#ff3c00',
  },
  btnDisabled: {
    opacity: 0.45,
    cursor: 'not-allowed',
  },
  previewWrap: {
    background: '#0d0d14',
    border: '1px solid #2a2a3a',
    borderRadius: '3px',
    padding: '12px',
    maxHeight: '240px',
    overflowY: 'auto',
  },
  previewHeading: {
    fontFamily: "'Courier New', monospace",
    fontSize: '10px',
    color: '#ff3c00',
    letterSpacing: '0.12em',
    marginBottom: '10px',
  },
  previewList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  previewRow: {
    display: 'grid',
    gridTemplateColumns: '1fr auto 1fr',
    gap: '8px',
    alignItems: 'baseline',
  },
  previewBefore: {
    fontFamily: "'Courier New', monospace",
    fontSize: '11px',
    color: '#888',
    wordBreak: 'break-word',
  },
  previewArrow: {
    fontFamily: "'Courier New', monospace",
    fontSize: '11px',
    color: '#ff3c00',
  },
  previewAfter: {
    fontFamily: "'Courier New', monospace",
    fontSize: '11px',
    color: '#e8e8e8',
    wordBreak: 'break-word',
  },
  errorList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    maxHeight: '120px',
    overflowY: 'auto',
  },
  errorItem: {
    fontFamily: "'Courier New', monospace",
    fontSize: '11px',
    color: '#f87171',
  },
};

// ─── IMAGE BACKFILL CARD ──────────────────────────────────────────────────────

function ImageBackfillCard() {
  const [status, setStatus]     = useState('idle'); // 'idle'|'running'|'done'|'error'
  const [progress, setProgress] = useState({ attached: 0, skipped: 0, total: 0 });
  const [errors, setErrors]     = useState([]);
  const [results, setResults]   = useState([]);
  const [brand, setBrand]       = useState('');

  const run = async (preview = false) => {
    setStatus('running');
    setProgress({ attached: 0, skipped: 0, total: 0 });
    setErrors([]);
    setResults([]);

    let cursor       = 0;
    let totalAttached = 0;
    let totalSkipped  = 0;
    let allErrors    = [];
    let allResults   = [];

    try {
      while (true) {
        let url = `/api/backfillImages?cursor=${cursor}`;
        if (preview)    url += '&preview=true';
        if (brand.trim()) url += `&brand=${encodeURIComponent(brand.trim())}`;

        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`Server error ${resp.status}`);
        const data = await resp.json();

        totalAttached += data.attached ?? 0;
        totalSkipped  += data.skipped  ?? 0;
        allErrors      = [...allErrors, ...(data.errors ?? [])];
        if (allResults.length < 30) {
          allResults = [...allResults, ...(data.results ?? [])].slice(0, 30);
        }

        setProgress({ attached: totalAttached, skipped: totalSkipped, total: data.total ?? 0 });
        setResults([...allResults]);

        if (data.nextCursor == null) break;
        cursor = data.nextCursor;

        // In preview mode only run the first chunk (diagnostic)
        if (preview) break;
      }

      setErrors(allErrors);
      setStatus('done');
    } catch (err) {
      setErrors(prev => [...prev, String(err)]);
      setStatus('error');
    }
  };

  const isRunning = status === 'running';
  const found     = results.filter(r => r.imageUrl);
  const notFound  = results.filter(r => !r.imageUrl);

  const sourceBadgeColor = (src) => ({
    'nexen-cdn':      '#facc15',
    'cooper-cdn':     '#38bdf8',
    'vredestein-cdn': '#a78bfa',
    'simpletire':     '#4ade80',
    'not-found':      '#555',
  }[src] ?? '#888');

  return (
    <div style={tsfc.card} className="dash-card">
      {/* Header row */}
      <div style={tsfc.top}>
        <div style={tsfc.titleRow}>
          <span style={styles.cardIcon}>🖼</span>
          <h3 style={styles.cardTitle}>Image Backfill</h3>
        </div>
        <span style={isRunning ? tsfc.badgeRunning : status === 'done' ? tsfc.badgeDone : tsfc.badgeIdle}>
          {isRunning ? '⟳ RUNNING' : status === 'done' ? '✓ DONE' : status === 'error' ? '✗ ERROR' : '● READY'}
        </span>
      </div>

      <p style={styles.cardDesc}>
        Find imageless products and attach images from Nexen, Cooper, Vredestein CDNs + SimpleTire fallback.
      </p>

      {/* Brand filter */}
      <div style={ibc.filterRow}>
        <label style={ibc.filterLabel}>BRAND FILTER</label>
        <input
          style={ibc.filterInput}
          type="text"
          placeholder="e.g. Nexen  (blank = all brands)"
          value={brand}
          onChange={e => setBrand(e.target.value)}
          disabled={isRunning}
        />
      </div>

      {/* Progress */}
      {(isRunning || status === 'done' || status === 'error') && (
        <div style={tsfc.progressWrap}>
          <div style={tsfc.progressLabel}>
            {isRunning
              ? `Attached ${progress.attached} / ${progress.total} — ${progress.skipped} skipped…`
              : `Attached ${progress.attached} / ${progress.total} — ${progress.skipped} skipped${errors.length ? ` — ${errors.length} error(s)` : ''}`
            }
          </div>
          {progress.total > 0 && (
            <div style={tsfc.barTrack}>
              <div style={{ ...tsfc.barFill, width: `${Math.round(((progress.attached + progress.skipped) / progress.total) * 100)}%` }} />
            </div>
          )}
        </div>
      )}

      {/* Buttons */}
      <div style={tsfc.btnRow}>
        <button
          style={{ ...tsfc.btn, ...tsfc.btnSecondary, ...(isRunning ? tsfc.btnDisabled : {}) }}
          onClick={() => run(true)}
          disabled={isRunning}
        >
          PREVIEW
        </button>
        <button
          style={{ ...tsfc.btn, ...tsfc.btnPrimary, ...(isRunning ? tsfc.btnDisabled : {}) }}
          onClick={() => run(false)}
          disabled={isRunning}
        >
          {isRunning ? 'RUNNING…' : 'RUN ALL'}
        </button>
      </div>

      {/* Results table */}
      {results.length > 0 && (
        <div style={tsfc.previewWrap}>
          <div style={tsfc.previewHeading}>
            RESULTS — {found.length} found · {notFound.length} not found (first {results.length})
          </div>
          <div style={tsfc.previewList}>
            {results.map((r, i) => (
              <div key={i} style={ibc.resultRow}>
                <span style={{ ...ibc.sourceBadge, color: sourceBadgeColor(r.source) }}>
                  {r.source}
                </span>
                <span style={tsfc.previewBefore}>{r.title}</span>
                {r.imageUrl
                  ? <a href={r.imageUrl} target="_blank" rel="noopener noreferrer" style={ibc.imageLink}>view ↗</a>
                  : <span style={ibc.noImage}>—</span>
                }
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Errors */}
      {errors.length > 0 && (
        <div style={tsfc.errorList}>
          {errors.map((e, i) => <div key={i} style={tsfc.errorItem}>⚠ {e}</div>)}
        </div>
      )}
    </div>
  );
}

// Styles scoped to ImageBackfillCard
const ibc = {
  filterRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  },
  filterLabel: {
    fontFamily: "'Courier New', monospace",
    fontSize: '10px',
    color: '#666',
    letterSpacing: '0.12em',
    whiteSpace: 'nowrap',
  },
  filterInput: {
    fontFamily: "'Courier New', monospace",
    fontSize: '12px',
    background: '#0d0d14',
    border: '1px solid #2a2a3a',
    borderRadius: '2px',
    color: '#e8e8e8',
    padding: '5px 10px',
    flex: 1,
    outline: 'none',
  },
  resultRow: {
    display: 'grid',
    gridTemplateColumns: '120px 1fr auto',
    gap: '8px',
    alignItems: 'baseline',
  },
  sourceBadge: {
    fontFamily: "'Courier New', monospace",
    fontSize: '10px',
    letterSpacing: '0.06em',
    whiteSpace: 'nowrap',
  },
  imageLink: {
    fontFamily: "'Courier New', monospace",
    fontSize: '11px',
    color: '#ff3c00',
    textDecoration: 'none',
    whiteSpace: 'nowrap',
  },
  noImage: {
    fontFamily: "'Courier New', monospace",
    fontSize: '11px',
    color: '#444',
  },
};

// ─── FIX VENDORS CARD ────────────────────────────────────────────────────────

function FixVendorsCard() {
  const [status, setStatus]     = useState('idle');
  const [progress, setProgress] = useState({ fixed: 0, total: 0 });
  const [errors, setErrors]     = useState([]);
  const [previewItems, setPreview] = useState([]);

  const run = async (preview = false) => {
    setStatus('running');
    setProgress({ fixed: 0, total: 0 });
    setErrors([]);
    setPreview([]);

    let cursor    = 0;
    let totalFixed = 0;
    let allErrors = [];
    let allPreview = [];

    try {
      while (true) {
        const url = `/api/fixVendors?cursor=${cursor}${preview ? '&preview=true' : ''}`;
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`Server error ${resp.status}`);
        const data = await resp.json();

        totalFixed += data.fixed ?? 0;
        allErrors   = [...allErrors, ...(data.errors ?? [])];
        if (allPreview.length < 20) {
          allPreview = [...allPreview, ...(data.preview ?? [])].slice(0, 20);
        }

        setProgress({ fixed: totalFixed, total: data.total ?? 0 });
        setPreview([...allPreview]);

        if (data.nextCursor == null) break;
        cursor = data.nextCursor;
        if (preview) break;
      }

      setErrors(allErrors);
      setStatus('done');
    } catch (err) {
      setErrors(prev => [...prev, String(err)]);
      setStatus('error');
    }
  };

  const isRunning = status === 'running';

  return (
    <div style={tsfc.card} className="dash-card">
      <div style={tsfc.top}>
        <div style={tsfc.titleRow}>
          <span style={styles.cardIcon}>🏪</span>
          <h3 style={styles.cardTitle}>Fix Vendors</h3>
        </div>
        <span style={isRunning ? tsfc.badgeRunning : status === 'done' ? tsfc.badgeDone : tsfc.badgeIdle}>
          {isRunning ? '⟳ RUNNING' : status === 'done' ? '✓ DONE' : status === 'error' ? '✗ ERROR' : '● READY'}
        </span>
      </div>

      <p style={styles.cardDesc}>
        Normalise vendor names from ALL-CAPS to Title Case (NEXEN → Nexen, COOPER → Cooper, VREDESTEIN → Vredestein). Runs in 50-product chunks.
      </p>

      {(isRunning || status === 'done' || status === 'error') && (
        <div style={tsfc.progressWrap}>
          <div style={tsfc.progressLabel}>
            {isRunning
              ? `Fixed ${progress.fixed} / ${progress.total}…`
              : `Fixed ${progress.fixed} / ${progress.total}${errors.length ? ` — ${errors.length} error(s)` : ''}`
            }
          </div>
          {progress.total > 0 && (
            <div style={tsfc.barTrack}>
              <div style={{ ...tsfc.barFill, width: `${Math.round((progress.fixed / progress.total) * 100)}%` }} />
            </div>
          )}
        </div>
      )}

      <div style={tsfc.btnRow}>
        <button
          style={{ ...tsfc.btn, ...tsfc.btnSecondary, ...(isRunning ? tsfc.btnDisabled : {}) }}
          onClick={() => run(true)}
          disabled={isRunning}
        >
          PREVIEW
        </button>
        <button
          style={{ ...tsfc.btn, ...tsfc.btnPrimary, ...(isRunning ? tsfc.btnDisabled : {}) }}
          onClick={() => run(false)}
          disabled={isRunning}
        >
          {isRunning ? 'RUNNING…' : 'RUN ALL'}
        </button>
      </div>

      {previewItems.length > 0 && (
        <div style={tsfc.previewWrap}>
          <div style={tsfc.previewHeading}>PREVIEW — {previewItems.length} vendor(s) to fix</div>
          <div style={tsfc.previewList}>
            {previewItems.map((item, i) => (
              <div key={i} style={tsfc.previewRow}>
                <span style={tsfc.previewBefore}>{item.before}</span>
                <span style={tsfc.previewArrow}>→</span>
                <span style={tsfc.previewAfter}>{item.after}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {errors.length > 0 && (
        <div style={tsfc.errorList}>
          {errors.map((e, i) => <div key={i} style={tsfc.errorItem}>⚠ {e}</div>)}
        </div>
      )}
    </div>
  );
}
function ReviewsCard() {
  const [pendingCount, setPendingCount] = useState(null);

  useEffect(() => {
    fetch('/api/reviews/pending-count')
      .then(r => r.json())
      .then(d => setPendingCount(d.pending ?? 0))
      .catch(() => setPendingCount('?'));
  }, []);

  return (
    <div style={tsfc.card} className="dash-card">
      <div style={tsfc.top}>
        <div style={tsfc.titleRow}>
          <span style={styles.cardIcon}>⭐</span>
          <h3 style={styles.cardTitle}>Reviews</h3>
        </div>
        <span style={{
          ...tsfc.badgeIdle,
          color: pendingCount > 0 ? '#facc15' : '#888',
        }}>
          {pendingCount === null ? '...' : `${pendingCount} PENDING`}
        </span>
      </div>
      <p style={styles.cardDesc}>
        Moderate customer reviews. Approve or reject pending submissions.
      </p>
      <Link to="/reviews" style={styles.launchBtn} className="dash-launch-btn">
        MODERATE
      </Link>
    </div>
  );
}
export default function Dashboard() {
  return (
    <div style={styles.root}>
      {/* Grid texture overlay */}
      <div style={styles.gridOverlay} />

      {/* Header */}
      <header style={styles.header}>
        <span style={styles.logo}>⚙ GCI BRAIN</span>
        <a
          href="https://gcitires.com"
          target="_blank"
          rel="noopener noreferrer"
          style={styles.headerLink}
        >
          gcitires.com ↗
        </a>
      </header>

      {/* Main content */}
      <main style={styles.main}>
        {/* CATALOG TOOLS — 60% */}
        <section style={styles.catalogSection}>
          <h2 style={styles.sectionHeading}>CATALOG TOOLS</h2>
          <div style={styles.catalogGrid}>
            {catalogTools.map((tool) => (
              <div key={tool.route} style={styles.card} className="dash-card">
                <div style={styles.cardTop}>
                  <span style={styles.cardIcon}>{tool.icon}</span>
                  <span style={styles.liveIndicator}>
                    <span style={styles.greenDot}>●</span> LIVE
                  </span>
                </div>
                <h3 style={styles.cardTitle}>{tool.title}</h3>
                <p style={styles.cardDesc}>{tool.description}</p>
                <Link to={tool.route} style={styles.launchBtn} className="dash-launch-btn">
                  LAUNCH
                </Link>
              </div>
            ))}
          </div>
        </section>

        {/* STORE TOOLS — 40% */}
        <section style={styles.storeSection}>
          <h2 style={styles.sectionHeading}>STORE TOOLS</h2>
          <div style={styles.storeStack}>
            {storeTools.map((tool) => (
              <div key={tool.url} style={styles.storeCard} className="dash-store-card">
                <div style={styles.storeCardLeft}>
                  <span style={styles.cardIcon}>{tool.icon}</span>
                  <div>
                    <h3 style={styles.storeCardTitle}>{tool.title}</h3>
                    <p style={styles.storeCardDesc}>{tool.description}</p>
                  </div>
                </div>
                <div style={styles.storeCardRight}>
                  <span style={styles.externalBadge}>↗ EXTERNAL</span>
                  <a
                    href={tool.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={styles.externalBtn}
                    className="dash-external-btn"
                  >
                    OPEN
                  </a>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* TRANSLATION TOOLS — full width row */}
        <section style={styles.translateSection}>
          <h2 style={styles.sectionHeading}>TRANSLATION TOOLS</h2>
          <TranslateContentCard />
        </section>

        {/* AUTOMATION TOOLS — full width row */}
        <section style={styles.translateSection}>
          <h2 style={styles.sectionHeading}>AUTOMATION TOOLS</h2>
          <div style={automationGrid}>
            <TireSizeFixCard />
            <ImageBackfillCard />
            <FixVendorsCard />
          </div>
        </section>
        {/* CUSTOMER TOOLS — full width row */}
        <section style={styles.translateSection}>
          <h2 style={styles.sectionHeading}>CUSTOMER TOOLS</h2>
          <div style={automationGrid}>
            <ReviewsCard />
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer style={styles.footer}>
        GROUPE DE COMMERCE INTERCONTINENTAL INC. — NEQ: 1178796265 — info@gcitires.com
      </footer>

      <style>{`
        .dash-card {
          transition: box-shadow 200ms ease, border-color 200ms ease, transform 200ms ease;
        }
        .dash-card:hover {
          box-shadow: 0 0 20px rgba(255,60,0,0.15) !important;
          border-color: #ff3c00 !important;
          transform: translateY(-2px);
        }
        .dash-store-card {
          transition: box-shadow 200ms ease, border-color 200ms ease;
        }
        .dash-store-card:hover {
          box-shadow: 0 0 20px rgba(255,60,0,0.15) !important;
          border-color: #ff3c00 !important;
        }
        .dash-launch-btn {
          transition: background 200ms ease, color 200ms ease, border-color 200ms ease;
        }
        .dash-launch-btn:hover {
          background: #ff3c00 !important;
          color: #fff !important;
          border-color: #ff3c00 !important;
        }
        .dash-external-btn {
          transition: background 200ms ease, color 200ms ease, border-color 200ms ease;
        }
        .dash-external-btn:hover {
          background: #ff3c00 !important;
          color: #fff !important;
          border-color: #ff3c00 !important;
        }
      `}</style>
    </div>
  );
}

const styles = {
  root: {
    minHeight: '100vh',
    background: '#0a0a0f',
    color: '#e8e8e8',
    fontFamily: "'Courier New', monospace",
    display: 'flex',
    flexDirection: 'column',
    position: 'relative',
    overflow: 'hidden',
  },
  gridOverlay: {
    position: 'fixed',
    inset: 0,
    backgroundImage:
      'linear-gradient(rgba(255,60,0,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,60,0,0.03) 1px, transparent 1px)',
    backgroundSize: '40px 40px',
    pointerEvents: 'none',
    zIndex: 0,
  },
  header: {
    position: 'relative',
    zIndex: 1,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '16px 32px',
    borderBottom: '1px solid #2a2a3a',
    background: '#0a0a0f',
  },
  logo: {
    fontFamily: "'Courier New', monospace",
    fontSize: '18px',
    fontWeight: 700,
    letterSpacing: '0.12em',
    color: '#ff3c00',
  },
  headerLink: {
    fontFamily: "'Courier New', monospace",
    fontSize: '13px',
    color: '#888',
    textDecoration: 'none',
    letterSpacing: '0.08em',
    transition: 'color 200ms ease',
  },
  main: {
    position: 'relative',
    zIndex: 1,
    display: 'flex',
    flex: 1,
    flexWrap: 'wrap',
    gap: '24px',
    padding: '32px',
    alignItems: 'flex-start',
  },
  catalogSection: {
    flex: '0 0 60%',
    maxWidth: '60%',
  },
  storeSection: {
    flex: '0 0 calc(40% - 24px)',
    maxWidth: 'calc(40% - 24px)',
  },
  sectionHeading: {
    fontFamily: 'Georgia, serif',
    fontSize: '13px',
    letterSpacing: '0.18em',
    color: '#ff3c00',
    marginBottom: '16px',
    marginTop: 0,
    borderBottom: '1px solid #2a2a3a',
    paddingBottom: '8px',
  },
  catalogGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: '16px',
  },
  card: {
    background: '#12121a',
    border: '1px solid #2a2a3a',
    borderRadius: '4px',
    padding: '20px',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    cursor: 'default',
  },
  cardTop: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardIcon: {
    fontSize: '22px',
    lineHeight: 1,
  },
  liveIndicator: {
    fontFamily: "'Courier New', monospace",
    fontSize: '11px',
    color: '#4ade80',
    letterSpacing: '0.1em',
  },
  greenDot: {
    color: '#4ade80',
  },
  externalBadge: {
    fontFamily: "'Courier New', monospace",
    fontSize: '11px',
    color: '#888',
    letterSpacing: '0.1em',
  },
  cardTitle: {
    fontFamily: 'Georgia, serif',
    fontSize: '16px',
    fontWeight: 700,
    margin: 0,
    color: '#e8e8e8',
  },
  cardDesc: {
    fontFamily: "'Courier New', monospace",
    fontSize: '12px',
    color: '#888',
    margin: 0,
    lineHeight: 1.5,
    flex: 1,
  },
  launchBtn: {
    display: 'inline-block',
    fontFamily: "'Courier New', monospace",
    fontSize: '12px',
    fontWeight: 700,
    letterSpacing: '0.12em',
    padding: '8px 16px',
    background: 'transparent',
    border: '1px solid #ff3c00',
    color: '#ff3c00',
    borderRadius: '2px',
    textDecoration: 'none',
    textAlign: 'center',
    alignSelf: 'flex-start',
    cursor: 'pointer',
  },
  storeStack: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  storeCard: {
    background: '#12121a',
    border: '1px solid #2a2a3a',
    borderRadius: '4px',
    padding: '16px 20px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '12px',
  },
  storeCardLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '14px',
    flex: 1,
    minWidth: 0,
  },
  storeCardTitle: {
    fontFamily: 'Georgia, serif',
    fontSize: '14px',
    fontWeight: 700,
    margin: '0 0 2px 0',
    color: '#e8e8e8',
  },
  storeCardDesc: {
    fontFamily: "'Courier New', monospace",
    fontSize: '11px',
    color: '#888',
    margin: 0,
  },
  storeCardRight: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: '6px',
    flexShrink: 0,
  },
  externalBtn: {
    display: 'inline-block',
    fontFamily: "'Courier New', monospace",
    fontSize: '11px',
    fontWeight: 700,
    letterSpacing: '0.12em',
    padding: '6px 12px',
    background: 'transparent',
    border: '1px solid #ff3c00',
    color: '#ff3c00',
    borderRadius: '2px',
    textDecoration: 'none',
    cursor: 'pointer',
  },
  translateSection: {
    width: '100%',
    flexBasis: '100%',
  },
  footer: {
    position: 'relative',
    zIndex: 1,
    textAlign: 'center',
    padding: '14px 32px',
    borderTop: '1px solid #2a2a3a',
    fontFamily: "'Courier New', monospace",
    fontSize: '11px',
    color: '#555',
    letterSpacing: '0.06em',
  },
};

const automationGrid = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
  gap: '16px',
};

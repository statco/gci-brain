import { useState, useRef, useCallback } from 'react';

const TABS = ['products', 'collections', 'pages', 'tags'];
const TAB_LABELS = {
  products: 'Products',
  collections: 'Collections',
  pages: 'Pages',
  tags: 'Tags',
};

const TAG_MAP_PREVIEW = [
  { fr: 'hiver', en: 'winter' },
  { fr: 'été', en: 'summer' },
  { fr: 'toutes-saisons', en: 'all-season' },
  { fr: 'quatre-saisons', en: 'all-season' },
  { fr: 'camion', en: 'truck' },
  { fr: 'tourisme', en: 'passenger' },
  { fr: 'tout-terrain', en: 'all-terrain' },
  { fr: 'pneu', en: 'tire' },
  { fr: 'pneus', en: 'tires' },
  { fr: 'livraison-gratuite', en: 'free-shipping' },
  { fr: 'en-stock', en: 'in-stock' },
];

const CHUNK_SIZE = 5;
const CHUNK_DELAY_MS = 2000;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export default function TranslateContentCard() {
  const [activeTab, setActiveTab] = useState('products');
  const [dryRun, setDryRun] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [running, setRunning] = useState(false);
  const [auditData, setAuditData] = useState({
    products: null,
    collections: null,
    pages: null,
    tags: null,
  });
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [log, setLog] = useState([]);
  const [errors, setErrors] = useState([]);
  const [summary, setSummary] = useState({ fixed: 0, skipped: 0, errors: 0 });
  const [done, setDone] = useState(false);
  const abortRef = useRef(false);
  const logEndRef = useRef(null);

  const addLog = useCallback((entry) => {
    setLog((prev) => [...prev, entry]);
    setTimeout(() => logEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
  }, []);

  // ── Scan All ──────────────────────────────────────────────────────

  async function handleScanAll() {
    setScanning(true);
    setAuditData({ products: null, collections: null, pages: null, tags: null });
    setLog([]);
    setErrors([]);
    setSummary({ fixed: 0, skipped: 0, errors: 0 });
    setDone(false);

    const types = ['products', 'collections', 'pages', 'tags'];
    const results = await Promise.all(
      types.map((type) =>
        fetch(`/api/translateContent?action=audit&type=${type}`)
          .then((r) => r.json())
          .catch((err) => ({ error: err.message }))
      )
    );

    const next = {};
    types.forEach((type, i) => {
      next[type] = results[i];
    });
    setAuditData(next);
    setScanning(false);
  }

  // ── Run translation ───────────────────────────────────────────────

  async function handleTranslate() {
    setRunning(true);
    abortRef.current = false;
    setLog([]);
    setErrors([]);
    setSummary({ fixed: 0, skipped: 0, errors: 0 });
    setDone(false);
    setProgress({ current: 0, total: 0 });

    const type = activeTab;
    const drParam = dryRun ? 'true' : 'false';
    addLog(`▶ ${dryRun ? '[DRY RUN] ' : ''}Starting ${TAB_LABELS[type]} translation…`);

    let offset = 0;
    let totalItems = 0;
    let totalFixed = 0;
    let totalSkipped = 0;
    let totalErrors = 0;

    while (!abortRef.current) {
      const url = `/api/translateContent?action=translate&type=${type}&offset=${offset}&chunkSize=${CHUNK_SIZE}&dryRun=${drParam}`;

      let data;
      try {
        const res = await fetch(url);
        data = await res.json();
      } catch (err) {
        addLog(`❌ Network error: ${err.message}`);
        break;
      }

      if (!data.success) {
        addLog(`❌ API error: ${data.error ?? 'Unknown error'}`);
        setErrors((prev) => [...prev, { id: 'api', title: 'API Error', error: data.error }]);
        break;
      }

      // Update totals
      totalItems =
        data.totalProducts ?? data.totalCollections ?? data.totalPages ?? totalItems;
      totalFixed += data.summary?.fixed ?? 0;
      totalSkipped += data.summary?.skipped ?? 0;
      totalErrors += data.summary?.errors ?? 0;

      setSummary({ fixed: totalFixed, skipped: totalSkipped, errors: totalErrors });
      setProgress({ current: data.chunk?.nextOffset ?? offset + CHUNK_SIZE, total: totalItems });

      // Log fixed items
      for (const item of data.fixed ?? []) {
        const preview = item.preview ? ` → "${item.preview}"` : '';
        addLog(
          `✓ [${item.id}] "${item.title}"${preview} — ${item.changes?.join(' | ')}`
        );
      }
      for (const item of data.errors ?? []) {
        addLog(`✗ [${item.id}] "${item.title}" — ${item.error}`);
        setErrors((prev) => [...prev, item]);
      }

      if (data.chunk?.done) {
        addLog(
          `✅ Done — fixed=${totalFixed} skipped=${totalSkipped} errors=${totalErrors}`
        );
        setDone(true);
        break;
      }

      offset = data.chunk?.nextOffset ?? offset + CHUNK_SIZE;
      await sleep(CHUNK_DELAY_MS);
    }

    setRunning(false);
  }

  function handleStop() {
    abortRef.current = true;
    addLog('⏹ Stopped by user.');
    setRunning(false);
  }

  // ── Render helpers ────────────────────────────────────────────────

  const currentAudit = auditData[activeTab];
  const progressPct =
    progress.total > 0 ? Math.min(100, Math.round((progress.current / progress.total) * 100)) : 0;

  return (
    <div style={s.card}>
      {/* Header */}
      <div style={s.cardHeader}>
        <div style={s.headerLeft}>
          <span style={s.icon}>🌐</span>
          <div>
            <h3 style={s.title}>Bulk FR→EN Translation</h3>
            <p style={s.subtitle}>Translate French content across Products, Collections, Pages & Tags</p>
          </div>
        </div>
        <button
          onClick={handleScanAll}
          disabled={scanning || running}
          style={{ ...s.btn, ...(scanning || running ? s.btnDisabled : {}) }}
          className="tc-btn"
        >
          {scanning ? '⏳ Scanning…' : '🔍 Scan All'}
        </button>
      </div>

      {/* Tabs */}
      <div style={s.tabs}>
        {TABS.map((tab) => {
          const audit = auditData[tab];
          const hasFrench = audit && !audit.error && audit.frenchCount > 0;
          return (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                ...s.tab,
                ...(activeTab === tab ? s.tabActive : {}),
              }}
              className={activeTab === tab ? 'tc-tab-active' : 'tc-tab'}
            >
              {TAB_LABELS[tab]}
              {hasFrench && (
                <span style={s.badge}>{audit.frenchCount}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div style={s.tabBody}>
        {/* Audit summary */}
        {currentAudit ? (
          currentAudit.error ? (
            <p style={s.errorText}>⚠ {currentAudit.error}</p>
          ) : (
            <div style={s.auditRow}>
              <div style={s.auditStat}>
                <span style={s.statNum}>{currentAudit.total ?? 0}</span>
                <span style={s.statLabel}>Total</span>
              </div>
              <div style={s.auditStat}>
                <span style={{ ...s.statNum, color: currentAudit.frenchCount > 0 ? '#ff6b00' : '#4ade80' }}>
                  {currentAudit.frenchCount ?? 0}
                </span>
                <span style={s.statLabel}>French detected</span>
              </div>
              {currentAudit.samples?.length > 0 && (
                <div style={s.samples}>
                  <span style={s.samplesLabel}>Samples:</span>
                  {currentAudit.samples.slice(0, 4).map((item) => (
                    <span key={item.id} style={s.samplePill}>
                      {item.title}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )
        ) : (
          <p style={s.hint}>
            {scanning ? 'Scanning…' : 'Click "Scan All" to detect French content'}
          </p>
        )}

        {/* Tags mapping preview */}
        {activeTab === 'tags' && (
          <div style={s.tagMap}>
            <span style={s.tagMapLabel}>Static mapping preview:</span>
            <div style={s.tagMapList}>
              {TAG_MAP_PREVIEW.map(({ fr, en }) => (
                <span key={fr} style={s.tagMapPill}>
                  {fr} → {en}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Controls */}
      <div style={s.controls}>
        <label style={s.checkLabel}>
          <input
            type="checkbox"
            checked={dryRun}
            onChange={(e) => setDryRun(e.target.checked)}
            disabled={running}
            style={s.checkbox}
          />
          <span>Dry run (preview only — no writes)</span>
        </label>

        <div style={s.controlBtns}>
          {running ? (
            <button onClick={handleStop} style={{ ...s.btn, ...s.btnStop }} className="tc-btn">
              ⏹ Stop
            </button>
          ) : (
            <button
              onClick={handleTranslate}
              disabled={scanning}
              style={{ ...s.btn, ...(dryRun ? s.btnPreview : s.btnLive), ...(scanning ? s.btnDisabled : {}) }}
              className="tc-btn"
            >
              {dryRun ? '👁 Preview Changes' : `🚀 Translate ${TAB_LABELS[activeTab]} Now`}
            </button>
          )}
        </div>
      </div>

      {/* Progress bar */}
      {(running || done) && progress.total > 0 && (
        <div style={s.progressWrap}>
          <div style={s.progressBar}>
            <div style={{ ...s.progressFill, width: `${progressPct}%` }} />
          </div>
          <span style={s.progressLabel}>
            {progress.current} / {progress.total} ({progressPct}%)
          </span>
        </div>
      )}

      {/* Summary badges */}
      {(running || done) && (
        <div style={s.summaryRow}>
          <span style={{ ...s.summaryBadge, background: '#16a34a22', color: '#4ade80' }}>
            ✓ {summary.fixed} fixed
          </span>
          <span style={{ ...s.summaryBadge, background: '#88888822', color: '#aaa' }}>
            — {summary.skipped} skipped
          </span>
          {summary.errors > 0 && (
            <span style={{ ...s.summaryBadge, background: '#dc262622', color: '#f87171' }}>
              ✗ {summary.errors} errors
            </span>
          )}
        </div>
      )}

      {/* Log */}
      {log.length > 0 && (
        <div style={s.logWrap}>
          {log.map((line, i) => (
            <div key={i} style={{
              ...s.logLine,
              color: line.startsWith('✓') ? '#4ade80'
                : line.startsWith('✗') ? '#f87171'
                : line.startsWith('❌') ? '#f87171'
                : line.startsWith('✅') ? '#4ade80'
                : line.startsWith('▶') ? '#ff6b00'
                : '#ccc',
            }}>
              {line}
            </div>
          ))}
          <div ref={logEndRef} />
        </div>
      )}

      {/* Error detail */}
      {errors.length > 0 && (
        <div style={s.errorBlock}>
          <span style={s.errorBlockTitle}>Errors ({errors.length})</span>
          {errors.map((e, i) => (
            <div key={i} style={s.errorItem}>
              [{e.id}] {e.title}: {e.error}
            </div>
          ))}
        </div>
      )}

      {/* Footer note */}
      <div style={s.footer}>
        Uses Claude Haiku per item · Always dry run first · Install Weglot after complete
      </div>

      <style>{`
        .tc-btn { transition: background 200ms ease, color 200ms ease, border-color 200ms ease, opacity 200ms ease; }
        .tc-btn:hover:not(:disabled) { opacity: 0.85; }
        .tc-tab { transition: background 150ms ease, color 150ms ease, border-color 150ms ease; }
        .tc-tab:hover { background: #1e1e2a !important; color: #e8e8e8 !important; }
        .tc-tab-active { cursor: default; }
      `}</style>
    </div>
  );
}

const s = {
  card: {
    background: '#12121a',
    border: '1px solid #2a2a3a',
    borderRadius: '4px',
    padding: '20px',
    display: 'flex',
    flexDirection: 'column',
    gap: '14px',
    fontFamily: "'Courier New', monospace",
  },
  cardHeader: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: '12px',
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '12px',
    flex: 1,
  },
  icon: {
    fontSize: '22px',
    lineHeight: 1,
    flexShrink: 0,
    marginTop: '2px',
  },
  title: {
    fontFamily: 'Georgia, serif',
    fontSize: '16px',
    fontWeight: 700,
    margin: '0 0 3px 0',
    color: '#e8e8e8',
  },
  subtitle: {
    fontFamily: "'Courier New', monospace",
    fontSize: '11px',
    color: '#888',
    margin: 0,
    lineHeight: 1.4,
  },
  btn: {
    fontFamily: "'Courier New', monospace",
    fontSize: '12px',
    fontWeight: 700,
    letterSpacing: '0.08em',
    padding: '8px 14px',
    background: 'transparent',
    border: '1px solid #ff3c00',
    color: '#ff3c00',
    borderRadius: '2px',
    cursor: 'pointer',
    flexShrink: 0,
  },
  btnDisabled: {
    opacity: 0.45,
    cursor: 'not-allowed',
  },
  btnStop: {
    borderColor: '#f87171',
    color: '#f87171',
  },
  btnPreview: {
    borderColor: '#60a5fa',
    color: '#60a5fa',
  },
  btnLive: {
    borderColor: '#ff3c00',
    color: '#ff3c00',
    background: 'rgba(255,60,0,0.08)',
  },
  tabs: {
    display: 'flex',
    gap: '4px',
    borderBottom: '1px solid #2a2a3a',
    paddingBottom: '0',
  },
  tab: {
    fontFamily: "'Courier New', monospace",
    fontSize: '12px',
    letterSpacing: '0.06em',
    padding: '7px 14px',
    background: 'transparent',
    border: '1px solid transparent',
    borderBottom: 'none',
    color: '#666',
    borderRadius: '2px 2px 0 0',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    position: 'relative',
    bottom: '-1px',
  },
  tabActive: {
    background: '#1a1a28',
    border: '1px solid #2a2a3a',
    borderBottom: '1px solid #1a1a28',
    color: '#ff3c00',
  },
  badge: {
    background: '#ff3c0033',
    color: '#ff6b00',
    fontSize: '10px',
    padding: '1px 5px',
    borderRadius: '8px',
    fontWeight: 700,
  },
  tabBody: {
    minHeight: '60px',
  },
  auditRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '20px',
    flexWrap: 'wrap',
  },
  auditStat: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '2px',
  },
  statNum: {
    fontSize: '22px',
    fontWeight: 700,
    color: '#e8e8e8',
    lineHeight: 1,
  },
  statLabel: {
    fontSize: '10px',
    color: '#666',
    letterSpacing: '0.06em',
  },
  samples: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    flexWrap: 'wrap',
    flex: 1,
  },
  samplesLabel: {
    fontSize: '10px',
    color: '#666',
    letterSpacing: '0.06em',
  },
  samplePill: {
    background: '#1e1e2a',
    border: '1px solid #333',
    borderRadius: '2px',
    fontSize: '10px',
    padding: '2px 7px',
    color: '#aaa',
    maxWidth: '160px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  hint: {
    fontSize: '11px',
    color: '#555',
    margin: 0,
  },
  tagMap: {
    marginTop: '10px',
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  tagMapLabel: {
    fontSize: '10px',
    color: '#666',
    letterSpacing: '0.06em',
  },
  tagMapList: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '5px',
  },
  tagMapPill: {
    background: '#1e1e2a',
    border: '1px solid #333',
    borderRadius: '2px',
    fontSize: '10px',
    padding: '2px 8px',
    color: '#888',
  },
  controls: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '12px',
    flexWrap: 'wrap',
    paddingTop: '4px',
    borderTop: '1px solid #2a2a3a',
  },
  checkLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '12px',
    color: '#aaa',
    cursor: 'pointer',
    userSelect: 'none',
  },
  checkbox: {
    accentColor: '#ff3c00',
    width: '14px',
    height: '14px',
    cursor: 'pointer',
  },
  controlBtns: {
    display: 'flex',
    gap: '8px',
  },
  progressWrap: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  },
  progressBar: {
    flex: 1,
    height: '6px',
    background: '#1e1e2a',
    borderRadius: '3px',
    overflow: 'hidden',
    border: '1px solid #2a2a3a',
  },
  progressFill: {
    height: '100%',
    background: 'linear-gradient(90deg, #ff3c00, #ff6b00)',
    borderRadius: '3px',
    transition: 'width 300ms ease',
  },
  progressLabel: {
    fontSize: '11px',
    color: '#666',
    whiteSpace: 'nowrap',
    minWidth: '90px',
    textAlign: 'right',
  },
  summaryRow: {
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap',
  },
  summaryBadge: {
    fontSize: '11px',
    padding: '3px 10px',
    borderRadius: '2px',
    letterSpacing: '0.04em',
  },
  logWrap: {
    background: '#0a0a0f',
    border: '1px solid #2a2a3a',
    borderRadius: '2px',
    padding: '12px',
    maxHeight: '260px',
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: '3px',
  },
  logLine: {
    fontSize: '11px',
    lineHeight: 1.5,
    wordBreak: 'break-word',
    fontFamily: "'Courier New', monospace",
  },
  errorBlock: {
    background: '#1a0a0a',
    border: '1px solid #5a2020',
    borderRadius: '2px',
    padding: '10px 12px',
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  errorBlockTitle: {
    fontSize: '11px',
    color: '#f87171',
    fontWeight: 700,
    marginBottom: '4px',
    letterSpacing: '0.06em',
  },
  errorItem: {
    fontSize: '10px',
    color: '#f87171',
    opacity: 0.8,
    wordBreak: 'break-word',
  },
  errorText: {
    fontSize: '11px',
    color: '#f87171',
    margin: 0,
  },
  footer: {
    fontSize: '10px',
    color: '#444',
    letterSpacing: '0.04em',
    borderTop: '1px solid #1e1e2a',
    paddingTop: '10px',
    textAlign: 'center',
  },
};

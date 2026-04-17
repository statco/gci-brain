import { useState, useRef, useEffect } from 'react';

const C = {
  bg: '#0b1120', surface: '#111827', border: '#1f2937',
  text: '#f9fafb', muted: '#6b7280',
  green: '#10b981', red: '#ef4444', yellow: '#f59e0b',
  blue: '#3b82f6', purple: '#8b5cf6',
};

function StatCard({ label, value, color, sub }) {
  return (
    <div style={{ background: `${color}11`, border: `1px solid ${color}33`, borderRadius: 10, padding: '12px 16px' }}>
      <div style={{ fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: '0.1em', fontFamily: 'monospace', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, color, fontFamily: "'DM Mono', monospace", lineHeight: 1 }}>{value ?? '—'}</div>
      {sub && <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function LogLine({ line }) {
  const isErr  = line.includes('❌') || line.includes('error') || line.includes('Error');
  const isDone = line.includes('✅') && (line.includes('done') || line.includes('Done') || line.includes('complete'));
  const isHead = line.startsWith('▶') || line.startsWith('📦') || line.startsWith('📊') || line.startsWith('🗂');
  const isSep  = line.includes('──────');
  const color  = isErr ? C.red : isDone ? C.green : isHead ? C.yellow : isSep ? '#333' : C.muted;
  return (
    <div style={{ fontFamily: "'DM Mono','Courier New',monospace", fontSize: 12, color, lineHeight: 1.7, fontWeight: isHead || isDone ? 600 : 400 }}>
      {line}
    </div>
  );
}

function Panel({ title, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, marginBottom: 16, overflow: 'hidden' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{ width: '100%', background: 'none', border: 'none', padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', color: C.text }}
      >
        <span style={{ fontWeight: 600, fontSize: 14 }}>{title}</span>
        <span style={{ color: C.muted, transform: open ? 'rotate(180deg)' : 'none', transition: '0.2s' }}>▾</span>
      </button>
      {open && <div style={{ padding: '0 18px 18px' }}>{children}</div>}
    </div>
  );
}

function Btn({ label, onClick, disabled, color = C.blue, outline = false }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      background: outline ? 'transparent' : color,
      color: outline ? color : 'white',
      border: `1px solid ${color}`,
      borderRadius: 7, padding: '8px 16px', fontSize: 13, fontWeight: 600,
      cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.4 : 1,
    }}>{label}</button>
  );
}

// ─── Sync Runner helper ────────────────────────────────────────────────────────
function useActionRunner() {
  const [log, setLog]       = useState([]);
  const [running, setRun]   = useState(false);
  const logRef              = useRef(null);

  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [log]);

  async function run(url, label) {
    setRun(true);
    setLog(l => [...l, `▶ ${label}…`]);
    try {
      const res  = await fetch(url);
      const data = await res.json();
      const summary = Object.entries(data)
        .filter(([k]) => ['updated','deleted','archived','fixed','created','redirected','errors','skipped','totalOrphans','duplicateGroups','canFix'].includes(k))
        .map(([k, v]) => `${k}:${v}`)
        .join('  ');
      setLog(l => [...l, `📊 ${summary || JSON.stringify(data).slice(0, 120)}`]);
      if (data.error) setLog(l => [...l, `❌ ${data.error}`]);
      else setLog(l => [...l, `✅ Done`]);
      return data;
    } catch (e) {
      setLog(l => [...l, `❌ ${e.message}`]);
    } finally {
      setRun(false);
    }
  }

  return { log, running, run, logRef, clearLog: () => setLog([]) };
}

// ─── PANELS ───────────────────────────────────────────────────────────────────

function StatusPanel() {
  const [status, setStatus] = useState(null);
  const [loading, setLoad]  = useState(false);
  async function refresh() {
    setLoad(true);
    try { const d = await fetch('/api/shopifySync?action=status').then(r => r.json()); setStatus(d); }
    finally { setLoad(false); }
  }
  useEffect(() => { refresh(); }, []);
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 14 }}>
        <StatCard label="Shopify Products" value={status?.shopifyProductCount?.toLocaleString()} color={C.green} />
        <StatCard label="CT Environment"   value={status?.ctEnvironment}   color={status?.ctEnvironment === 'PRODUCTION' ? C.green : C.yellow} />
        <StatCard label="Next Cron"         value={status?.nextCron ?? '3:00 AM ET'} color={C.blue} />
      </div>
      <Btn label={loading ? 'Refreshing…' : '↻ Refresh'} onClick={refresh} disabled={loading} outline color={C.muted} />
    </div>
  );
}

function FullSyncPanel() {
  const { log, running, run, logRef, clearLog } = useActionRunner();
  const [offset,    setOffset]    = useState(0);
  const [upOffset,  setUpOffset]  = useState(0);
  const [chunkSize, setChunkSize] = useState(50);
  const [upChunk,   setUpChunk]   = useState(200);
  const [stats,     setStats]     = useState(null);

  async function runSync() {
    const url = `/api/shopifySync?action=full-import&offset=${offset}&chunkSize=${chunkSize}&updateOffset=${upOffset}&updateChunk=${upChunk}`;
    const data = await run(url, `Full Import offset=${offset} updateOffset=${upOffset}`);
    if (data) {
      setStats(data);
      if (!data.updateDone) setUpOffset(data.nextUpdateOffset ?? upOffset + upChunk);
    }
  }

  return (
    <div>
      <p style={{ fontSize: 12, color: C.muted, marginTop: 0 }}>
        Pulls in-stock tires from CT API and creates/updates Shopify products.
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 14 }}>
        {[['Import offset', offset, setOffset, 70], ['Import chunk', chunkSize, setChunkSize, 60], ['Update offset', upOffset, setUpOffset, 70], ['Update chunk', upChunk, setUpChunk, 60]].map(([lbl, val, set, w]) => (
          <label key={lbl} style={{ fontSize: 12, color: C.muted }}>
            {lbl}
            <input type="number" value={val} onChange={e => set(Number(e.target.value))} disabled={running}
              style={{ marginLeft: 6, width: w, background: '#0f172a', border: `1px solid ${C.border}`, borderRadius: 5, color: C.text, padding: '3px 7px', fontSize: 12 }} />
          </label>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
        <Btn label={running ? 'Running…' : '▶ Run Chunk'} onClick={runSync} disabled={running} color={C.green} />
        <Btn label="Reset offsets" onClick={() => { setOffset(0); setUpOffset(0); }} disabled={running} outline color={C.muted} />
      </div>
      {stats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 14 }}>
          <StatCard label="Created"  value={stats.created}  color={C.green} />
          <StatCard label="Updated"  value={stats.updated}  color={C.blue} />
          <StatCard label="Skipped"  value={stats.skipped}  color={C.muted} />
          <StatCard label="Errors"   value={stats.errors}   color={C.red} />
        </div>
      )}
      {log.length > 0 && (
        <div style={{ background: '#0f172a', borderRadius: 8, padding: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: 10, color: '#4b5563', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Log</span>
            <button onClick={clearLog} style={{ background: 'none', border: 'none', color: '#4b5563', cursor: 'pointer', fontSize: 11 }}>clear</button>
          </div>
          <div ref={logRef} style={{ maxHeight: 200, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 1 }}>
            {log.map((l, i) => <LogLine key={i} line={l} />)}
          </div>
        </div>
      )}
    </div>
  );
}

function DedupPanel() {
  const { log, running, run, logRef, clearLog } = useActionRunner();
  const [stats, setStats] = useState(null);

  async function dryRun() {
    const data = await run('/api/shopifySync?action=dedup', 'Dedup dry run');
    if (data) setStats(data);
  }
  async function live() {
    const data = await run('/api/shopifySync?action=dedup&confirm=true', 'Dedup LIVE');
    if (data) setStats(data);
  }

  return (
    <div>
      <p style={{ fontSize: 12, color: C.muted, marginTop: 0 }}>
        Finds products with identical titles. Keeps newest (most images, highest ID). Creates 301 redirects before deleting.
      </p>
      <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
        <Btn label={running ? 'Running…' : '🔍 Dry Run'} onClick={dryRun} disabled={running} outline color={C.blue} />
        <Btn label={running ? 'Running…' : '🗑 Run Live'} onClick={live} disabled={running} color={C.red} />
      </div>
      {stats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 14 }}>
          <StatCard label="Duplicate Groups" value={stats.duplicateGroups ?? stats.wouldDelete} color={C.yellow} />
          <StatCard label="Deleted"          value={stats.deleted ?? '—'}                       color={C.red} />
          <StatCard label="Redirects"        value={stats.redirected ?? '—'}                    color={C.green} />
        </div>
      )}
      {log.length > 0 && (
        <div style={{ background: '#0f172a', borderRadius: 8, padding: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: 10, color: '#4b5563', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Log</span>
            <button onClick={clearLog} style={{ background: 'none', border: 'none', color: '#4b5563', cursor: 'pointer', fontSize: 11 }}>clear</button>
          </div>
          <div ref={logRef} style={{ maxHeight: 200, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 1 }}>
            {log.map((l, i) => <LogLine key={i} line={l} />)}
          </div>
        </div>
      )}
    </div>
  );
}

function LoadIndexPanel() {
  const { log, running, run, logRef, clearLog } = useActionRunner();
  const [stats, setStats] = useState(null);

  async function dryRun() {
    const data = await run('/api/shopifySync?action=fill-missing-loadindex&dryRun=true', 'Load index dry run');
    if (data) setStats(data);
  }
  async function live() {
    const data = await run('/api/shopifySync?action=fill-missing-loadindex&dryRun=false', 'Fill load index LIVE');
    if (data) setStats(data);
  }

  return (
    <div>
      <p style={{ fontSize: 12, color: C.muted, marginTop: 0 }}>
        Finds products missing <code style={{ background: '#1e293b', padding: '1px 5px', borderRadius: 3, fontSize: 11 }}>loadindex:</code> tags and fills them from CT size map.
      </p>
      <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
        <Btn label={running ? 'Running…' : '🔍 Dry Run'} onClick={dryRun} disabled={running} outline color={C.blue} />
        <Btn label={running ? 'Running…' : '▶ Run Live'} onClick={live}    disabled={running} color={C.green} />
      </div>
      {stats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 14 }}>
          <StatCard label="Missing"    value={stats.totalMissing} color={C.yellow} />
          <StatCard label="Fixable"    value={stats.canFix}       color={C.blue} />
          <StatCard label="Fixed"      value={stats.fixed ?? '—'} color={C.green} />
        </div>
      )}
      {log.length > 0 && (
        <div style={{ background: '#0f172a', borderRadius: 8, padding: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: 10, color: '#4b5563', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Log</span>
            <button onClick={clearLog} style={{ background: 'none', border: 'none', color: '#4b5563', cursor: 'pointer', fontSize: 11 }}>clear</button>
          </div>
          <div ref={logRef} style={{ maxHeight: 200, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 1 }}>
            {log.map((l, i) => <LogLine key={i} line={l} />)}
          </div>
        </div>
      )}
    </div>
  );
}

function OrphansPanel() {
  const { log, running, run, logRef, clearLog } = useActionRunner();
  const [stats, setStats]   = useState(null);
  const [limit, setLimit]   = useState(100);

  async function findOrphans() {
    const data = await run('/api/shopifySync?action=find-orphans', 'Find orphans');
    if (data) setStats(data);
  }
  async function archiveDry() {
    const data = await run(`/api/shopifySync?action=archive-orphans&dryRun=true&limit=${limit}`, 'Archive orphans dry run');
    if (data) setStats(s => ({ ...s, ...data }));
  }
  async function archiveLive() {
    const data = await run(`/api/shopifySync?action=archive-orphans&dryRun=false&limit=${limit}`, 'Archive orphans LIVE');
    if (data) setStats(s => ({ ...s, ...data }));
  }

  return (
    <div>
      <p style={{ fontSize: 12, color: C.muted, marginTop: 0 }}>
        Cross-references Shopify SKUs against CT API. Products with no CT match are orphaned (TIRE-XXXXXXX MPN products are excluded).
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 14, alignItems: 'center' }}>
        <Btn label={running ? 'Running…' : '🔍 Find Orphans'} onClick={findOrphans} disabled={running} outline color={C.blue} />
        <label style={{ fontSize: 12, color: C.muted }}>
          Limit
          <input type="number" value={limit} onChange={e => setLimit(Number(e.target.value))} disabled={running}
            style={{ marginLeft: 6, width: 60, background: '#0f172a', border: `1px solid ${C.border}`, borderRadius: 5, color: C.text, padding: '3px 7px', fontSize: 12 }} />
        </label>
        <Btn label={running ? 'Running…' : '📋 Archive Dry'} onClick={archiveDry}  disabled={running} outline color={C.yellow} />
        <Btn label={running ? 'Running…' : '📦 Archive Live'} onClick={archiveLive} disabled={running} color={C.yellow} />
      </div>
      {stats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 14 }}>
          <StatCard label="Total Orphans"   value={stats.totalOrphans}   color={C.yellow} />
          <StatCard label="Sold-out tagged" value={stats.soldOutOrphans} color={C.muted} />
          <StatCard label="Truly Orphaned"  value={stats.trulyOrphaned}  color={C.red} />
          <StatCard label="Archived"        value={stats.archived ?? '—'} color={C.green} />
        </div>
      )}
      {log.length > 0 && (
        <div style={{ background: '#0f172a', borderRadius: 8, padding: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: 10, color: '#4b5563', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Log</span>
            <button onClick={clearLog} style={{ background: 'none', border: 'none', color: '#4b5563', cursor: 'pointer', fontSize: 11 }}>clear</button>
          </div>
          <div ref={logRef} style={{ maxHeight: 200, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 1 }}>
            {log.map((l, i) => <LogLine key={i} line={l} />)}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function ShopifySync() {
  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.text, fontFamily: "'Inter', system-ui, sans-serif", padding: '32px 24px' }}>
      <div style={{ maxWidth: 800, margin: '0 auto' }}>

        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 28 }}>
          <a href="/brain" style={{ color: C.muted, textDecoration: 'none', fontSize: 13 }}>← Brain</a>
          <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>⚙️ Shopify Sync</h1>
        </div>

        <Panel title="📊 Status" defaultOpen>
          <StatusPanel />
        </Panel>

        <Panel title="🔄 Full Import — CT → Shopify" defaultOpen>
          <FullSyncPanel />
        </Panel>

        <Panel title="🗑 Dedup — Delete Duplicates + Redirects">
          <DedupPanel />
        </Panel>

        <Panel title="🏷 Fill Missing Load Index Tags">
          <LoadIndexPanel />
        </Panel>

        <Panel title="👻 Orphan Products">
          <OrphansPanel />
        </Panel>

      </div>
    </div>
  );
}

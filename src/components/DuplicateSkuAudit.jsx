import { useState, useRef, useEffect } from "react";

function StatCard({ label, value, color }) {
  const accent = color ?? "#9ca3af";
  return (
    <div style={{
      background: `${accent}11`,
      border: `1px solid ${accent}33`,
      borderRadius: 10,
      padding: "14px 18px",
      display: "flex",
      flexDirection: "column",
      gap: 4,
    }}>
      <span style={{ fontSize: 11, color: "#888", textTransform: "uppercase", letterSpacing: "0.1em", fontFamily: "monospace" }}>
        {label}
      </span>
      <span style={{ fontSize: 28, fontWeight: 700, color: accent, fontFamily: "'DM Mono', monospace", lineHeight: 1 }}>
        {value ?? 0}
      </span>
    </div>
  );
}

function LogLine({ line, index }) {
  const isError   = line.includes("❌");
  const isDone    = line.startsWith("✅");
  const isWarning = line.includes("⚠️");
  const isHeader  = line.startsWith("▶") || line.startsWith("📊") || line.startsWith("🔍 Scan") || line.startsWith("🔍 Fix");
  const isScan    = line.startsWith("🔍") && !isHeader;
  const isSep     = line.includes("──────");

  const color = isError   ? "#f87171"
    : isDone    ? "#34d399"
    : isWarning ? "#9ca3af"
    : isHeader  ? "#fbbf24"
    : isScan    ? "#9ca3af"
    : isSep     ? "#333"
    : "#9ca3af";

  return (
    <div style={{
      fontFamily: "'DM Mono', 'Courier New', monospace",
      fontSize: 12,
      color,
      lineHeight: 1.7,
      opacity: isHeader ? 1 : 0.9,
      fontWeight: isHeader || isDone ? 600 : 400,
      animation: `fadeIn 0.2s ease ${Math.min(index * 0.02, 0.5)}s both`,
    }}>
      {line}
    </div>
  );
}

function GroupsTable({ groups }) {
  if (!groups || groups.length === 0) {
    return (
      <div style={{ padding: "24px 0", textAlign: "center", color: "#34d399", fontSize: 13, fontWeight: 600 }}>
        ✅ No duplicate TIRE- SKUs found
      </div>
    );
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "'DM Mono', monospace", fontSize: 11 }}>
        <thead>
          <tr style={{ borderBottom: "1px solid #222" }}>
            {["SKU", "Count", "Products"].map(h => (
              <th key={h} style={{ padding: "6px 10px", textAlign: "left", color: "#555", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, fontSize: 10 }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groups.map((group, i) => {
            const titles = group.variants.map(v => v.productTitle);
            const unique = [...new Set(titles)];
            const display = unique.length <= 2
              ? unique.join(", ")
              : `${unique[0]}, ${unique[1]} +${unique.length - 2} more`;

            return (
              <tr key={group.sku} style={{ borderBottom: "1px solid #1a1a1a", background: i % 2 === 0 ? "transparent" : "#0d0d0d" }}>
                <td style={{ padding: "7px 10px", color: "#f59e0b", fontWeight: 600 }}>{group.sku}</td>
                <td style={{ padding: "7px 10px", color: "#f87171", textAlign: "center" }}>{group.count}</td>
                <td style={{ padding: "7px 10px", color: "#6b7280", maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={unique.join(", ")}>{display}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function DuplicateSkuAudit() {
  const [chunkSize,         setChunkSize]         = useState(20);
  const [offset,            setOffset]            = useState(0);
  const [dryRun,            setDryRun]            = useState(true);
  const [autoContinue,      setAutoContinue]      = useState(false);
  const [running,           setRunning]           = useState(false);
  const [isAutoRunning,     setIsAutoRunning]     = useState(false);
  const [log,               setLog]               = useState([]);
  const [summary,           setSummary]           = useState(null);
  const [scanGroups,        setScanGroups]        = useState(null);   // groups from last scan
  const [cumulativeSummary, setCumulativeSummary] = useState(null);
  const [nextOffset,        setNextOffset]        = useState(null);
  const logRef           = useRef(null);
  const stopRequestedRef = useRef(false);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);

  async function runAudit() {
    const doAutoContinue = autoContinue;
    stopRequestedRef.current = false;

    if (doAutoContinue) setIsAutoRunning(true);

    const action = dryRun ? 'scan' : 'fix';
    let currentOffset = offset;
    let isFirstBatch  = true;
    let cumulative    = { duplicateSkus: 0, affectedVariants: 0, fixed: 0, errors: 0 };

    setCumulativeSummary(null);
    setScanGroups(null);
    setSummary(null);
    setNextOffset(null);
    setLog([`▶ Starting ${action.toUpperCase()}${dryRun ? " [DRY RUN]" : ""} — chunkSize=${chunkSize} offset=${currentOffset}…`]);

    while (true) {
      setRunning(true);

      let batchSummary    = null;
      let batchNextOffset = null;
      let success         = true;

      try {
        const params = new URLSearchParams({ action, chunkSize: String(chunkSize), offset: String(currentOffset) });
        if (dryRun && action === 'fix') params.set('dry', 'true');

        const res  = await fetch(`/api/duplicateSkuAudit?${params}`);
        const json = await res.json();

        if (!res.ok) {
          setLog(l => [...l, `❌ API error: ${json.error || res.statusText}`]);
          success = false;
        } else if (action === 'scan') {
          // Build log from scan response
          const newLines = [
            `📊 Products scanned: ${json.totalProducts}  |  Variants: ${json.totalVariants}`,
            `🔍 Duplicate TIRE- SKUs: ${json.totalDuplicateSkus}  |  Affected variants: ${json.totalAffectedVariants}`,
            ...(json.groups || []).map(g => {
              const titles = [...new Set(g.variants.map(v => v.productTitle))];
              const display = titles.length <= 2 ? titles.join(", ") : `${titles[0]} +${titles.length - 1} more`;
              return `🔍 ${g.sku}  ×${g.count}  — ${display}`;
            }),
            json.totalDuplicateSkus === 0 ? "✅ No duplicate SKUs found — catalog is clean" : `⚠️ ${json.totalDuplicateSkus} duplicate SKU(s) need attention`,
          ];
          setLog(isFirstBatch ? newLines : l => [...l, "──────────────────────────────", ...newLines]);

          setScanGroups(json.groups || []);
          batchSummary = {
            duplicateSkus:    json.totalDuplicateSkus,
            affectedVariants: json.totalAffectedVariants,
            fixed:  0,
            errors: 0,
          };
          setSummary(batchSummary);
          // Scan is always a single call — never auto-continues
          batchNextOffset = null;

        } else {
          // fix response
          const newLines = [
            `📊 Duplicate SKUs total: ${json.totalDuplicateSkus}  |  Chunk offset: ${json.offset}`,
            ...(json.changes || []).map(c => `✅ Cleared SKU ${c.sku} from variant ${c.variantId} (${c.productTitle})`),
            ...(json.errors  || []).map(e => `❌ ${e}`),
            `📊 Chunk done — fixed: ${json.fixed}  skipped: ${json.skipped}  errors: ${json.errors?.length ?? 0}`,
          ];
          setLog(isFirstBatch ? newLines : l => [...l, "──────────────────────────────", ...newLines]);

          batchSummary = {
            duplicateSkus:    json.totalDuplicateSkus,
            affectedVariants: 0,
            fixed:  json.fixed  || 0,
            errors: json.errors?.length ?? 0,
          };
          setSummary(batchSummary);

          if (json.nextOffset != null) {
            batchNextOffset = json.nextOffset;
            setNextOffset(json.nextOffset);
          }
        }

        if (batchSummary) {
          Object.keys(cumulative).forEach(k => {
            cumulative[k] = (cumulative[k] || 0) + (batchSummary[k] || 0);
          });
          if (doAutoContinue) setCumulativeSummary({ ...cumulative });
        }

      } catch (err) {
        setLog(l => [...l, `❌ Fetch error: ${err.message}`]);
        success = false;
      } finally {
        setRunning(false);
      }

      isFirstBatch = false;

      const canContinue = doAutoContinue
        && success
        && batchSummary
        && (batchSummary.errors || 0) === 0
        && batchNextOffset != null
        && !stopRequestedRef.current;

      if (!canContinue) {
        if (doAutoContinue) {
          if (success && batchSummary && batchNextOffset == null) {
            setLog(l => [...l, "✅ All chunks complete."]);
          }
          setIsAutoRunning(false);
        }
        break;
      }

      // 3…2…1… countdown between batches
      for (let i = 3; i >= 1; i--) {
        setLog(l => {
          const filtered = l.filter(line => !line.startsWith("⏱"));
          return [...filtered, `⏱ Next batch in ${i}…`];
        });
        await new Promise(r => setTimeout(r, 1000));
        if (stopRequestedRef.current) break;
      }

      if (stopRequestedRef.current) {
        setLog(l => l.filter(line => !line.startsWith("⏱")));
        setIsAutoRunning(false);
        break;
      }

      setLog(l => l.filter(line => !line.startsWith("⏱")));
      currentOffset = batchNextOffset;
      setOffset(batchNextOffset);
    }
  }

  const STAT_DEFS = [
    { key: "duplicateSkus",    label: "Duplicate SKUs",    color: "#f59e0b" },
    { key: "affectedVariants", label: "Affected Variants", color: "#9ca3af" },
    { key: "fixed",            label: "Fixed",             color: "#34d399" },
    { key: "errors",           label: "Errors",            color: "#f87171" },
  ];

  const action    = dryRun ? 'scan' : 'fix';
  const apiUrlStr = `/api/duplicateSkuAudit?action=${action}&chunkSize=${chunkSize}&offset=${offset}`;

  return (
    <div style={{ minHeight: "100vh", background: "#0a0a0a", color: "#fff", fontFamily: "'DM Sans', 'Segoe UI', sans-serif", padding: "32px 24px", boxSizing: "border-box" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=DM+Mono:wght@400;600&display=swap');
        @keyframes fadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.4; } }
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: #111; }
        ::-webkit-scrollbar-thumb { background: #333; border-radius: 2px; }
      `}</style>

      <div style={{ maxWidth: 860, margin: "0 auto" }}>
        {/* Header */}
        <div style={{ marginBottom: 32, animation: "fadeIn 0.4s ease" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
            <div style={{ width: 36, height: 36, borderRadius: 8, background: "linear-gradient(135deg, #f59e0b, #d97706)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>🔎</div>
            <div>
              <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.02em" }}>GCI Tires — Duplicate SKU Audit</div>
              <div style={{ fontSize: 12, color: "#555", fontFamily: "monospace" }}>gci-brain.vercel.app/api/duplicateSkuAudit</div>
            </div>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
          {/* Left panel — Configuration */}
          <div style={{ background: "#111", border: "1px solid #1e1e1e", borderRadius: 14, padding: 24, animation: "fadeIn 0.4s ease 0.1s both" }}>
            <div style={{ fontSize: 11, color: "#555", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 20 }}>Configuration</div>

            {/* Chunk size (only meaningful for fix action) */}
            <div style={{ marginBottom: 16, opacity: dryRun ? 0.45 : 1, transition: "opacity 0.2s" }}>
              <label style={{ fontSize: 12, color: "#666", display: "block", marginBottom: 8 }}>
                Chunk Size — <span style={{ color: "#f59e0b" }}>{chunkSize} groups</span>
              </label>
              <input type="range" min={5} max={50} step={5} value={chunkSize}
                onChange={e => setChunkSize(Number(e.target.value))}
                style={{ width: "100%", accentColor: "#f59e0b", cursor: "pointer" }} />
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#444", marginTop: 4 }}>
                <span>5</span><span>25</span><span>50</span>
              </div>
            </div>

            {/* Offset */}
            <div style={{ marginBottom: 20, opacity: dryRun ? 0.45 : 1, transition: "opacity 0.2s" }}>
              <label style={{ fontSize: 12, color: "#666", display: "block", marginBottom: 8 }}>
                Offset — <span style={{ color: "#9ca3af" }}>start from group #{offset}</span>
              </label>
              <div style={{ display: "flex", gap: 6 }}>
                <input type="number" min={0} step={chunkSize} value={offset}
                  onChange={e => setOffset(Number(e.target.value))}
                  style={{ flex: 1, background: "#0a0a0a", border: "1px solid #222", borderRadius: 7, padding: "7px 10px", color: "#fff", fontSize: 13, fontFamily: "monospace" }} />
                <button onClick={() => setOffset(0)} style={{ background: "#1a1a1a", border: "1px solid #222", borderRadius: 7, color: "#555", fontSize: 11, padding: "0 12px", cursor: "pointer" }}>Reset</button>
              </div>
            </div>

            {/* Dry Run / Live Mode toggle */}
            <div
              style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", background: dryRun ? "rgba(245,158,11,0.06)" : "rgba(239,68,68,0.06)", border: `1px solid ${dryRun ? "rgba(245,158,11,0.2)" : "rgba(239,68,68,0.2)"}`, borderRadius: 9, marginBottom: 12, cursor: "pointer" }}
              onClick={() => setDryRun(d => !d)}
            >
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: dryRun ? "#f59e0b" : "#f87171" }}>{dryRun ? "🔍 Scan Mode" : "⚡ Fix Mode"}</div>
                <div style={{ fontSize: 11, color: "#555", marginTop: 2 }}>{dryRun ? "Scan only — no writes (action=scan)" : "Will clear duplicate SKUs in Shopify"}</div>
              </div>
              <div style={{ width: 36, height: 20, borderRadius: 10, background: dryRun ? "#f59e0b" : "#ef4444", position: "relative", transition: "background 0.2s" }}>
                <div style={{ position: "absolute", top: 2, left: dryRun ? 18 : 2, width: 16, height: 16, borderRadius: "50%", background: "#fff", transition: "left 0.2s" }} />
              </div>
            </div>

            {/* Auto-Continue toggle */}
            <div
              style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", background: autoContinue ? "rgba(245,158,11,0.06)" : "rgba(255,255,255,0.02)", border: `1px solid ${autoContinue ? "rgba(245,158,11,0.2)" : "rgba(255,255,255,0.06)"}`, borderRadius: 9, marginBottom: 20, cursor: dryRun ? "not-allowed" : "pointer", opacity: dryRun ? 0.45 : 1, transition: "opacity 0.2s" }}
              onClick={() => { if (!dryRun) setAutoContinue(a => !a); }}
            >
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: autoContinue && !dryRun ? "#f59e0b" : "#555" }}>🔁 Auto-Continue</div>
                <div style={{ fontSize: 11, color: "#555", marginTop: 2 }}>Runs all fix chunks automatically</div>
              </div>
              <div style={{ width: 36, height: 20, borderRadius: 10, background: autoContinue && !dryRun ? "#f59e0b" : "#333", position: "relative", transition: "background 0.2s" }}>
                <div style={{ position: "absolute", top: 2, left: autoContinue && !dryRun ? 18 : 2, width: 16, height: 16, borderRadius: "50%", background: "#fff", transition: "left 0.2s" }} />
              </div>
            </div>

            {/* Run / Stop button */}
            {isAutoRunning ? (
              <button
                onClick={() => { stopRequestedRef.current = true; }}
                style={{ width: "100%", background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.35)", borderRadius: 10, padding: "13px 0", color: "#f87171", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "'DM Sans', sans-serif" }}
              >
                ⏹ Stop
              </button>
            ) : (
              <button onClick={runAudit} disabled={running} style={{ width: "100%", background: running ? "#1a1a1a" : dryRun ? "linear-gradient(135deg, #f59e0b, #d97706)" : "linear-gradient(135deg, #f87171, #ef4444)", border: "none", borderRadius: 10, padding: "13px 0", color: running ? "#444" : "#fff", fontSize: 14, fontWeight: 700, cursor: running ? "not-allowed" : "pointer", fontFamily: "'DM Sans', sans-serif", transition: "all 0.2s ease", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                {running ? <><span style={{ display: "inline-block", animation: "spin 0.8s linear infinite", fontSize: 16 }}>⟳</span>Processing…</> : dryRun ? "🔍 Scan for Duplicates" : "⚡ Fix Duplicates"}
              </button>
            )}

            {nextOffset != null && !running && !isAutoRunning && (
              <button onClick={() => { setOffset(nextOffset); setNextOffset(null); }} style={{ width: "100%", marginTop: 8, background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.3)", borderRadius: 10, padding: "11px 0", color: "#f59e0b", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "'DM Sans', sans-serif" }}>
                ↪ Continue from offset {nextOffset}
              </button>
            )}
          </div>

          {/* Right panel — Results */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* Stats */}
            <div style={{ background: "#111", border: "1px solid #1e1e1e", borderRadius: 14, padding: 24, animation: "fadeIn 0.4s ease 0.15s both" }}>
              <div style={{ fontSize: 11, color: "#555", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 16 }}>Summary</div>
              {summary ? (
                <>
                  {cumulativeSummary && (
                    <>
                      <div style={{ fontSize: 10, color: "#444", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8, fontFamily: "monospace" }}>Cumulative Totals</div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>
                        {STAT_DEFS.map(({ key, label, color }) => (
                          <StatCard key={key} label={label} value={cumulativeSummary[key]} color={key === "errors" && cumulativeSummary[key] > 0 ? "#f87171" : color} />
                        ))}
                      </div>
                      <div style={{ fontSize: 10, color: "#444", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8, fontFamily: "monospace" }}>Last Batch</div>
                    </>
                  )}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    {STAT_DEFS.map(({ key, label, color }) => (
                      <StatCard key={key} label={label} value={summary[key]} color={key === "errors" && summary[key] > 0 ? "#f87171" : color} />
                    ))}
                  </div>
                </>
              ) : (
                <div style={{ height: 120, display: "flex", alignItems: "center", justifyContent: "center", color: "#333", fontSize: 13, fontStyle: "italic" }}>
                  {running ? <span style={{ animation: "pulse 1s ease infinite" }}>Running…</span> : "Run a scan to see results"}
                </div>
              )}
            </div>

            {/* API URL preview */}
            <div style={{ background: "#111", border: "1px solid #1e1e1e", borderRadius: 14, padding: 16, animation: "fadeIn 0.4s ease 0.2s both" }}>
              <div style={{ fontSize: 11, color: "#555", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 10 }}>API URL</div>
              <div style={{ fontFamily: "monospace", fontSize: 11, color: "#f59e0b", background: "#0a0a0a", border: "1px solid #1a1a1a", borderRadius: 7, padding: "8px 12px", wordBreak: "break-all", lineHeight: 1.6 }}>
                {apiUrlStr}
              </div>
            </div>
          </div>
        </div>

        {/* Duplicate groups table */}
        <div style={{ marginTop: 20, background: "#080808", border: "1px solid #1a1a1a", borderRadius: 14, overflow: "hidden", animation: "fadeIn 0.4s ease 0.2s both" }}>
          <div style={{ padding: "12px 20px", borderBottom: "1px solid #1a1a1a", display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 11, color: "#555", textTransform: "uppercase", letterSpacing: "0.12em" }}>
              Duplicate Groups {scanGroups !== null ? `(${scanGroups.length})` : ""}
            </span>
          </div>
          <div style={{ padding: "0 4px", minHeight: 80 }}>
            {scanGroups === null ? (
              <div style={{ padding: "28px 20px", color: "#2a2a2a", fontFamily: "monospace", fontSize: 12 }}>
                {running ? <span style={{ color: "#555", animation: "pulse 1s ease infinite" }}>Scanning…</span> : "$ run a scan to see duplicate groups"}
              </div>
            ) : (
              <GroupsTable groups={scanGroups} />
            )}
          </div>
        </div>

        {/* Console log */}
        <div style={{ marginTop: 16, background: "#080808", border: "1px solid #1a1a1a", borderRadius: 14, overflow: "hidden", animation: "fadeIn 0.4s ease 0.25s both" }}>
          <div style={{ padding: "12px 20px", borderBottom: "1px solid #1a1a1a", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: running || isAutoRunning ? "#f59e0b" : log.length ? "#fbbf24" : "#333", animation: running || isAutoRunning ? "pulse 1s ease infinite" : "none" }} />
              <span style={{ fontSize: 11, color: "#555", textTransform: "uppercase", letterSpacing: "0.12em" }}>Console Output</span>
            </div>
            {log.length > 0 && (
              <button onClick={() => setLog([])} style={{ background: "none", border: "none", color: "#333", fontSize: 11, cursor: "pointer", fontFamily: "monospace" }}>clear</button>
            )}
          </div>
          <div ref={logRef} style={{ height: 280, overflowY: "auto", padding: "16px 20px" }}>
            {log.length === 0
              ? <div style={{ color: "#2a2a2a", fontFamily: "monospace", fontSize: 12 }}>$ waiting for run…</div>
              : log.map((line, i) => <LogLine key={i} line={line} index={i} />)
            }
          </div>
        </div>
      </div>
    </div>
  );
}

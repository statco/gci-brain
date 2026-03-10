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
  const isError    = line.includes("❌");
  const isDone     = line.includes("✅ All redirects created.");
  const isCountdown= line.startsWith("⏱");
  const isHeader   = line.includes("▶") || line.includes("📊") || line.includes("📦");
  const isRedirect = line.includes("[redirect]");
  const isDryRun   = line.includes("[dry-run]");
  const isSkipped  = line.includes("[skipped]");
  const isNotFound = line.includes("[not-found]");
  const isSep      = line.includes("──────");

  const color = isError    ? "#f87171"
    : isDone     ? "#34d399"
    : isCountdown? "#fbbf24"
    : isHeader   ? "#fbbf24"
    : isRedirect ? "#34d399"
    : isDryRun   ? "#60a5fa"
    : isSkipped  ? "#9ca3af"
    : isNotFound ? "#f59e0b"
    : isSep      ? "#333"
    : "#9ca3af";

  return (
    <div style={{
      fontFamily: "'DM Mono', 'Courier New', monospace",
      fontSize: 12,
      color,
      lineHeight: 1.7,
      opacity: isHeader ? 1 : 0.9,
      fontWeight: isHeader || isDone ? 600 : 400,
      borderLeft: isRedirect || isDryRun ? `2px solid ${color}33` : "none",
      paddingLeft: isRedirect || isDryRun ? 8 : 0,
      animation: `fadeIn 0.2s ease ${Math.min(index * 0.02, 0.5)}s both`,
    }}>
      {line}
    </div>
  );
}

export default function FixRedirects() {
  const [chunkSize,       setChunkSize]       = useState(50);
  const [offset,          setOffset]          = useState(0);
  const [dryRun,          setDryRun]          = useState(true);
  const [autoContinue,    setAutoContinue]    = useState(false);
  const [running,         setRunning]         = useState(false);
  const [isAutoRunning,   setIsAutoRunning]   = useState(false);
  const [log,             setLog]             = useState([]);
  const [summary,         setSummary]         = useState(null);
  const [cumulativeSummary, setCumulativeSummary] = useState(null);
  const [nextOffset,      setNextOffset]      = useState(null);
  const logRef           = useRef(null);
  const stopRequestedRef = useRef(false);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);

  async function runFix() {
    const doAutoContinue = autoContinue;
    stopRequestedRef.current = false;

    if (doAutoContinue) setIsAutoRunning(true);

    let currentOffset = offset;
    let isFirstBatch  = true;
    let cumulative    = { scanned: 0, redirected: 0, skipped: 0, notFound: 0, errors: 0 };

    setCumulativeSummary(null);
    setLog([`▶ Starting${dryRun ? " [DRY RUN]" : ""} — chunkSize=${chunkSize} offset=${currentOffset}…`]);
    setSummary(null);
    setNextOffset(null);

    while (true) {
      setRunning(true);

      let batchSummary    = null;
      let batchNextOffset = null;
      let success         = true;

      try {
        const params = new URLSearchParams({
          chunkSize: String(chunkSize),
          offset: String(currentOffset),
          ...(dryRun ? { dryRun: "true" } : {}),
        });

        const res  = await fetch(`/api/fixRedirects?${params}`);
        const json = await res.json();

        if (json.log) {
          if (isFirstBatch) {
            setLog(json.log);
          } else {
            setLog(l => [...l, "──────────────────────────────", ...json.log]);
          }
        }

        if (json.summary) {
          batchSummary = json.summary;
          setSummary(json.summary);

          Object.keys(cumulative).forEach(k => {
            cumulative[k] = (cumulative[k] || 0) + (json.summary[k] || 0);
          });

          if (doAutoContinue) setCumulativeSummary({ ...cumulative });
        }

        if (json.nextOffset != null) {
          batchNextOffset = json.nextOffset;
          setNextOffset(json.nextOffset);
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
        && batchSummary.scanned > 0
        && (batchSummary.errors || 0) === 0
        && batchNextOffset != null
        && !stopRequestedRef.current;

      if (!canContinue) {
        if (doAutoContinue) {
          if (success && batchSummary && batchSummary.scanned === 0) {
            setLog(l => [...l, "✅ All redirects created."]);
          }
          setIsAutoRunning(false);
        }
        break;
      }

      // Countdown 3…2…1…
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
    { key: "scanned",    label: "Scanned",    color: "#9ca3af" },
    { key: "redirected", label: "Redirected", color: "#34d399" },
    { key: "skipped",    label: "Skipped",    color: "#9ca3af" },
    { key: "notFound",   label: "Not Found",  color: "#f59e0b" },
    { key: "errors",     label: "Errors",     color: "#f87171" },
  ];

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
            <div style={{ width: 36, height: 36, borderRadius: 8, background: "linear-gradient(135deg, #34d399, #059669)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>🔀</div>
            <div>
              <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.02em" }}>GCI Tires — Fix Redirects</div>
              <div style={{ fontSize: 12, color: "#555", fontFamily: "monospace" }}>gci-brain.vercel.app/api/fixRedirects</div>
            </div>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
          {/* Left panel — Configuration */}
          <div style={{ background: "#111", border: "1px solid #1e1e1e", borderRadius: 14, padding: 24, animation: "fadeIn 0.4s ease 0.1s both" }}>
            <div style={{ fontSize: 11, color: "#555", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 20 }}>Configuration</div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, color: "#666", display: "block", marginBottom: 8 }}>
                Chunk Size — <span style={{ color: "#34d399" }}>{chunkSize} products</span>
              </label>
              <input type="range" min={10} max={100} step={10} value={chunkSize}
                onChange={e => setChunkSize(Number(e.target.value))}
                style={{ width: "100%", accentColor: "#34d399", cursor: "pointer" }} />
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#444", marginTop: 4 }}>
                <span>10</span><span>50</span><span>100</span>
              </div>
            </div>

            <div style={{ marginBottom: 20 }}>
              <label style={{ fontSize: 12, color: "#666", display: "block", marginBottom: 8 }}>
                Offset — <span style={{ color: "#9ca3af" }}>start from product #{offset}</span>
              </label>
              <div style={{ display: "flex", gap: 6 }}>
                <input type="number" min={0} step={chunkSize} value={offset}
                  onChange={e => setOffset(Number(e.target.value))}
                  style={{ flex: 1, background: "#0a0a0a", border: "1px solid #222", borderRadius: 7, padding: "7px 10px", color: "#fff", fontSize: 13, fontFamily: "monospace" }} />
                <button onClick={() => setOffset(0)} style={{ background: "#1a1a1a", border: "1px solid #222", borderRadius: 7, color: "#555", fontSize: 11, padding: "0 12px", cursor: "pointer" }}>Reset</button>
              </div>
            </div>

            {/* Dry Run toggle */}
            <div
              style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", background: dryRun ? "rgba(52,211,153,0.06)" : "rgba(239,68,68,0.06)", border: `1px solid ${dryRun ? "rgba(52,211,153,0.2)" : "rgba(239,68,68,0.2)"}`, borderRadius: 9, marginBottom: 12, cursor: "pointer" }}
              onClick={() => setDryRun(d => !d)}
            >
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: dryRun ? "#34d399" : "#f87171" }}>{dryRun ? "🔍 Dry Run Mode" : "⚡ Live Mode"}</div>
                <div style={{ fontSize: 11, color: "#555", marginTop: 2 }}>{dryRun ? "No writes — preview only" : "Will write to Shopify"}</div>
              </div>
              <div style={{ width: 36, height: 20, borderRadius: 10, background: dryRun ? "#34d399" : "#ef4444", position: "relative", transition: "background 0.2s" }}>
                <div style={{ position: "absolute", top: 2, left: dryRun ? 18 : 2, width: 16, height: 16, borderRadius: "50%", background: "#fff", transition: "left 0.2s" }} />
              </div>
            </div>

            {/* Auto-Continue toggle */}
            <div
              style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", background: autoContinue ? "rgba(52,211,153,0.06)" : "rgba(255,255,255,0.02)", border: `1px solid ${autoContinue ? "rgba(52,211,153,0.2)" : "rgba(255,255,255,0.06)"}`, borderRadius: 9, marginBottom: 20, cursor: "pointer" }}
              onClick={() => setAutoContinue(a => !a)}
            >
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: autoContinue ? "#34d399" : "#555" }}>🔁 Auto-Continue</div>
                <div style={{ fontSize: 11, color: "#555", marginTop: 2 }}>Runs all batches automatically</div>
              </div>
              <div style={{ width: 36, height: 20, borderRadius: 10, background: autoContinue ? "#34d399" : "#333", position: "relative", transition: "background 0.2s" }}>
                <div style={{ position: "absolute", top: 2, left: autoContinue ? 18 : 2, width: 16, height: 16, borderRadius: "50%", background: "#fff", transition: "left 0.2s" }} />
              </div>
            </div>

            {isAutoRunning ? (
              <button
                onClick={() => { stopRequestedRef.current = true; }}
                style={{ width: "100%", background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.35)", borderRadius: 10, padding: "13px 0", color: "#f87171", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "'DM Sans', sans-serif" }}
              >
                ⏹ Stop
              </button>
            ) : (
              <button onClick={runFix} disabled={running} style={{ width: "100%", background: running ? "#1a1a1a" : "linear-gradient(135deg, #34d399, #059669)", border: "none", borderRadius: 10, padding: "13px 0", color: running ? "#444" : "#000", fontSize: 14, fontWeight: 700, cursor: running ? "not-allowed" : "pointer", fontFamily: "'DM Sans', sans-serif", transition: "all 0.2s ease", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                {running ? <><span style={{ display: "inline-block", animation: "spin 0.8s linear infinite", fontSize: 16 }}>⟳</span>Processing…</> : `▶ Run${dryRun ? " (Dry Run)" : ""}`}
              </button>
            )}

            {nextOffset != null && !running && !isAutoRunning && (
              <button onClick={() => { setOffset(nextOffset); setNextOffset(null); }} style={{ width: "100%", marginTop: 8, background: "rgba(96,165,250,0.1)", border: "1px solid rgba(96,165,250,0.3)", borderRadius: 10, padding: "11px 0", color: "#60a5fa", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "'DM Sans', sans-serif" }}>
                ↪ Continue from offset {nextOffset}
              </button>
            )}
          </div>

          {/* Right panel — Results */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
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
                  {running ? <span style={{ animation: "pulse 1s ease infinite" }}>Running…</span> : "No run yet — configure and click Run"}
                </div>
              )}
            </div>

            <div style={{ background: "#111", border: "1px solid #1e1e1e", borderRadius: 14, padding: 16, animation: "fadeIn 0.4s ease 0.2s both" }}>
              <div style={{ fontSize: 11, color: "#555", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 10 }}>API URL</div>
              <div style={{ fontFamily: "monospace", fontSize: 11, color: "#60a5fa", background: "#0a0a0a", border: "1px solid #1a1a1a", borderRadius: 7, padding: "8px 12px", wordBreak: "break-all", lineHeight: 1.6 }}>
                /api/fixRedirects?chunkSize={chunkSize}&offset={offset}{dryRun ? "&dryRun=true" : ""}
              </div>
            </div>
          </div>
        </div>

        {/* Console log */}
        <div style={{ marginTop: 20, background: "#080808", border: "1px solid #1a1a1a", borderRadius: 14, overflow: "hidden", animation: "fadeIn 0.4s ease 0.25s both" }}>
          <div style={{ padding: "12px 20px", borderBottom: "1px solid #1a1a1a", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: running || isAutoRunning ? "#34d399" : log.length ? "#fbbf24" : "#333", animation: running || isAutoRunning ? "pulse 1s ease infinite" : "none" }} />
              <span style={{ fontSize: 11, color: "#555", textTransform: "uppercase", letterSpacing: "0.12em" }}>Console Output</span>
            </div>
            {log.length > 0 && (
              <button onClick={() => setLog([])} style={{ background: "none", border: "none", color: "#333", fontSize: 11, cursor: "pointer", fontFamily: "monospace" }}>clear</button>
            )}
          </div>
          <div ref={logRef} style={{ height: 320, overflowY: "auto", padding: "16px 20px" }}>
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

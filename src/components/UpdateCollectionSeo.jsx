import { useState, useRef, useEffect } from "react";

function LogLine({ line, index }) {
  const isError  = line.includes("❌");
  const isDone   = line.includes("✅ All done!");
  const isHeader = line.includes("🚀") || line.includes("📊") || line.includes("📦") || line.includes("📋");
  const isSkip   = line.includes("⚠️") || line.includes("[SKIP]");
  const isDry    = line.includes("[DRY RUN]");
  const isOk     = line.includes("✅") && !isDone;
  const isSep    = line.includes("──────");
  const isIndent = line.startsWith("   ");

  const color = isError  ? "#f87171"
    : isDone   ? "#34d399"
    : isHeader ? "#fbbf24"
    : isSkip   ? "#f59e0b"
    : isDry    ? "#60a5fa"
    : isOk     ? "#34d399"
    : isSep    ? "#333"
    : isIndent ? "#6b7280"
    : "#9ca3af";

  return (
    <div style={{
      fontFamily: "'DM Mono', 'Courier New', monospace",
      fontSize: 12,
      color,
      lineHeight: 1.7,
      fontWeight: isHeader || isDone ? 600 : 400,
      borderLeft: isDry || isOk ? `2px solid ${color}33` : "none",
      paddingLeft: isDry || isOk || isIndent ? 8 : 0,
      animation: `fadeIn 0.2s ease ${Math.min(index * 0.02, 0.5)}s both`,
    }}>
      {line}
    </div>
  );
}

export default function UpdateCollectionSeo() {
  const [dryRun,  setDryRun]  = useState(true);
  const [running, setRunning] = useState(false);
  const [log,     setLog]     = useState([]);
  const [summary, setSummary] = useState(null);
  const logRef = useRef(null);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);

  async function runUpdate() {
    setRunning(true);
    setLog([`▶ Starting${dryRun ? " [DRY RUN]" : " [LIVE]"}…`]);
    setSummary(null);

    try {
      const params = new URLSearchParams(dryRun ? { dryRun: "true" } : {});
      const res  = await fetch(`/api/updateCollectionSeo?${params}`);
      const json = await res.json();

      if (json.log)     setLog(json.log);
      if (json.summary) setSummary(json.summary);
    } catch (err) {
      setLog(l => [...l, `❌ Fetch error: ${err.message}`]);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", background: "#0a0a0a", color: "#fff", fontFamily: "'DM Sans', 'Segoe UI', sans-serif", padding: "32px 24px", boxSizing: "border-box" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=DM+Mono:wght@400;600&display=swap');
        @keyframes fadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
        @keyframes spin   { to { transform: rotate(360deg); } }
        @keyframes pulse  { 0%,100% { opacity:1; } 50% { opacity:0.4; } }
        * { box-sizing: border-box; }
        ::-webkit-scrollbar       { width: 4px; }
        ::-webkit-scrollbar-track { background: #111; }
        ::-webkit-scrollbar-thumb { background: #333; border-radius: 2px; }
      `}</style>

      <div style={{ maxWidth: 760, margin: "0 auto" }}>
        {/* Header */}
        <div style={{ marginBottom: 32, animation: "fadeIn 0.4s ease" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
            <div style={{ width: 36, height: 36, borderRadius: 8, background: "linear-gradient(135deg, #fbbf24, #f59e0b)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>🌐</div>
            <div>
              <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.02em" }}>GCI Tires — Collection SEO</div>
              <div style={{ fontSize: 12, color: "#555", fontFamily: "monospace" }}>gci-brain.vercel.app/api/updateCollectionSeo</div>
            </div>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 20 }}>
          {/* Controls */}
          <div style={{ background: "#111", border: "1px solid #1e1e1e", borderRadius: 14, padding: 24, animation: "fadeIn 0.4s ease 0.1s both" }}>
            <div style={{ fontSize: 11, color: "#555", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 20 }}>Configuration</div>

            {/* Dry Run toggle */}
            <div
              style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", background: dryRun ? "rgba(251,191,36,0.06)" : "rgba(239,68,68,0.06)", border: `1px solid ${dryRun ? "rgba(251,191,36,0.2)" : "rgba(239,68,68,0.2)"}`, borderRadius: 9, marginBottom: 24, cursor: "pointer" }}
              onClick={() => setDryRun(d => !d)}
            >
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: dryRun ? "#fbbf24" : "#f87171" }}>{dryRun ? "🔍 Dry Run Mode" : "⚡ Live Mode"}</div>
                <div style={{ fontSize: 11, color: "#555", marginTop: 2 }}>{dryRun ? "No writes — preview only" : "Will write SEO to Shopify"}</div>
              </div>
              <div style={{ width: 36, height: 20, borderRadius: 10, background: dryRun ? "#fbbf24" : "#ef4444", position: "relative", transition: "background 0.2s" }}>
                <div style={{ position: "absolute", top: 2, left: dryRun ? 2 : 18, width: 16, height: 16, borderRadius: "50%", background: "#fff", transition: "left 0.2s" }} />
              </div>
            </div>

            {/* Info */}
            <div style={{ fontSize: 12, color: "#444", fontFamily: "monospace", marginBottom: 24, lineHeight: 1.6, padding: "10px 12px", background: "#0a0a0a", borderRadius: 8, border: "1px solid #1a1a1a" }}>
              Targets 21 collections:<br />
              Winter · Summer · All-Season · All-Weather<br />
              SUV & Crossover · Light Truck · All-Terrain<br />
              Passenger Car · Cooper · Nexen · Vredestein<br />
              Maxtrek · Minerva · Ovation · Starfire · Kenda<br />
              Transeagle · Falken · GT Radial · Kelly · Pirelli
            </div>

            {/* Run button */}
            <button
              onClick={runUpdate}
              disabled={running}
              style={{ width: "100%", background: running ? "#1a1a1a" : "linear-gradient(135deg, #fbbf24, #f59e0b)", border: "none", borderRadius: 10, padding: "13px 0", color: running ? "#444" : "#000", fontSize: 14, fontWeight: 700, cursor: running ? "not-allowed" : "pointer", fontFamily: "'DM Sans', sans-serif", transition: "all 0.2s ease", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}
            >
              {running
                ? <><span style={{ display: "inline-block", animation: "spin 0.8s linear infinite", fontSize: 16 }}>⟳</span>Processing…</>
                : `▶ Run${dryRun ? " (Dry Run)" : " (Live)"}`
              }
            </button>
          </div>

          {/* Summary */}
          <div style={{ background: "#111", border: "1px solid #1e1e1e", borderRadius: 14, padding: 24, animation: "fadeIn 0.4s ease 0.15s both" }}>
            <div style={{ fontSize: 11, color: "#555", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 16 }}>Results</div>
            {summary ? (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                {[
                  { label: "Updated",  value: summary.updated,  color: "#34d399" },
                  { label: "Skipped",  value: summary.skipped,  color: "#fbbf24" },
                  { label: "Errors",   value: summary.errors,   color: summary.errors > 0 ? "#f87171" : "#555" },
                ].map(({ label, value, color }) => (
                  <div key={label} style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 10, padding: "14px 18px" }}>
                    <div style={{ fontSize: 11, color: "#888", textTransform: "uppercase", letterSpacing: "0.1em", fontFamily: "monospace", marginBottom: 4 }}>{label}</div>
                    <div style={{ fontSize: 28, fontWeight: 700, color, fontFamily: "'DM Mono', monospace", lineHeight: 1 }}>{value ?? 0}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ height: 100, display: "flex", alignItems: "center", justifyContent: "center", color: "#333", fontSize: 13, fontStyle: "italic" }}>
                {running
                  ? <span style={{ animation: "pulse 1s ease infinite" }}>Running…</span>
                  : "No run yet — click Run to start"
                }
              </div>
            )}

            {/* API URL */}
            <div style={{ marginTop: 20 }}>
              <div style={{ fontSize: 11, color: "#555", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 8 }}>API URL</div>
              <div style={{ fontFamily: "monospace", fontSize: 11, color: "#60a5fa", background: "#0a0a0a", border: "1px solid #1a1a1a", borderRadius: 7, padding: "8px 12px", wordBreak: "break-all", lineHeight: 1.6 }}>
                /api/updateCollectionSeo{dryRun ? "?dryRun=true" : ""}
              </div>
            </div>
          </div>
        </div>

        {/* Console */}
        <div style={{ background: "#080808", border: "1px solid #1a1a1a", borderRadius: 14, overflow: "hidden", animation: "fadeIn 0.4s ease 0.2s both" }}>
          <div style={{ padding: "12px 20px", borderBottom: "1px solid #1a1a1a", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: running ? "#34d399" : log.length ? "#fbbf24" : "#333", animation: running ? "pulse 1s ease infinite" : "none" }} />
              <span style={{ fontSize: 11, color: "#555", textTransform: "uppercase", letterSpacing: "0.12em" }}>Console Output</span>
            </div>
            {log.length > 0 && (
              <button onClick={() => { setLog([]); setSummary(null); }} style={{ background: "none", border: "none", color: "#333", fontSize: 11, cursor: "pointer", fontFamily: "monospace" }}>clear</button>
            )}
          </div>
          <div ref={logRef} style={{ height: 340, overflowY: "auto", padding: "16px 20px" }}>
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

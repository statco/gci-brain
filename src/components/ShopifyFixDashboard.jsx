import { useState, useRef, useEffect } from "react";

const TASKS = [
  { id: "all",    label: "All Tasks",         icon: "⚡" },
  { id: "size",   label: "Fix Size Format",   icon: "🔧" },
  { id: "images", label: "Assign Images",     icon: "🖼️" },
  { id: "seo",    label: "Translate SEO",     icon: "🌐" },
];

const STAT_LABELS = {
  scanned:        "Products Scanned",
  sizeFixed:      "body_html Fixed",
  variantsFixed:  "Variants Fixed",
  imagesAssigned: "Images Assigned",
  seoTranslated:  "SEO Translated",
  errors:         "Errors",
};

function StatCard({ label, value, accent }) {
  return (
    <div style={{
      background: accent ? "rgba(251,191,36,0.08)" : "rgba(255,255,255,0.03)",
      border: `1px solid ${accent ? "rgba(251,191,36,0.3)" : "rgba(255,255,255,0.07)"}`,
      borderRadius: 10,
      padding: "14px 18px",
      display: "flex",
      flexDirection: "column",
      gap: 4,
      transition: "all 0.3s ease",
    }}>
      <span style={{ fontSize: 11, color: "#888", textTransform: "uppercase", letterSpacing: "0.1em", fontFamily: "monospace" }}>
        {label}
      </span>
      <span style={{
        fontSize: 28,
        fontWeight: 700,
        color: accent ? "#fbbf24" : "#fff",
        fontFamily: "'DM Mono', monospace",
        lineHeight: 1,
      }}>
        {value ?? 0}
      </span>
    </div>
  );
}

function LogLine({ line, index }) {
  const isError   = line.includes("❌");
  const isHeader  = line.includes("🚀") || line.includes("📊");
  const isFixed   = line.includes("[1]") || line.includes("[2]");
  const isImage   = line.includes("[3]");
  const isSeo     = line.includes("[4]");
  const isResume  = line.includes("Next chunk");
  const isSep     = line.includes("──────");

  const color = isError ? "#f87171"
    : isHeader ? "#fbbf24"
    : isFixed  ? "#34d399"
    : isImage  ? "#60a5fa"
    : isSeo    ? "#a78bfa"
    : isResume ? "#fbbf24"
    : isSep    ? "#333"
    : "#9ca3af";

  return (
    <div style={{
      fontFamily: "'DM Mono', 'Courier New', monospace",
      fontSize: 12,
      color,
      lineHeight: 1.7,
      opacity: isHeader ? 1 : 0.9,
      fontWeight: isHeader ? 600 : 400,
      borderLeft: isFixed || isImage || isSeo ? `2px solid ${color}33` : "none",
      paddingLeft: isFixed || isImage || isSeo ? 8 : 0,
      animation: `fadeIn 0.2s ease ${Math.min(index * 0.02, 0.5)}s both`,
    }}>
      {line}
    </div>
  );
}

export default function ShopifyFixDashboard() {
  const [task,       setTask]       = useState("all");
  const [chunkSize,  setChunkSize]  = useState(10);
  const [offset,     setOffset]     = useState(0);
  const [dryRun,     setDryRun]     = useState(true);
  const [running,    setRunning]    = useState(false);
  const [log,        setLog]        = useState([]);
  const [stats,      setStats]      = useState(null);
  const [nextOffset, setNextOffset] = useState(null);
  const [history,    setHistory]    = useState([]);
  const logRef = useRef(null);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);

  async function runFix() {
    setRunning(true);
    setLog([`▶ Starting${dryRun ? " [DRY RUN]" : ""} — task=${task} chunkSize=${chunkSize} offset=${offset}…`]);
    setStats(null);
    setNextOffset(null);

    try {
      const params = new URLSearchParams({
        task,
        chunkSize: String(chunkSize),
        offset: String(offset),
        ...(dryRun ? { dryRun: "true" } : {}),
      });

      const res  = await fetch(`/api/shopifyFix?${params}`);
      const json = await res.json();

      if (json.log)   setLog(json.log);
      if (json.stats) setStats(json.stats);
      if (json.nextOffset != null) {
        setNextOffset(json.nextOffset);
        setHistory(h => [...h, { offset, chunkSize, task, dryRun, stats: json.stats }]);
      }
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
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.4; } }
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: #111; }
        ::-webkit-scrollbar-thumb { background: #333; border-radius: 2px; }
      `}</style>

      <div style={{ maxWidth: 860, margin: "0 auto" }}>
        <div style={{ marginBottom: 32, animation: "fadeIn 0.4s ease" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
            <div style={{ width: 36, height: 36, borderRadius: 8, background: "linear-gradient(135deg, #fbbf24, #f59e0b)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>🛞</div>
            <div>
              <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.02em" }}>GCI Tires — Shopify Fix</div>
              <div style={{ fontSize: 12, color: "#555", fontFamily: "monospace" }}>gci-brain.vercel.app/api/shopifyFix</div>
            </div>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
          <div style={{ background: "#111", border: "1px solid #1e1e1e", borderRadius: 14, padding: 24, animation: "fadeIn 0.4s ease 0.1s both" }}>
            <div style={{ fontSize: 11, color: "#555", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 20 }}>Configuration</div>

            <div style={{ marginBottom: 20 }}>
              <label style={{ fontSize: 12, color: "#666", display: "block", marginBottom: 8 }}>Task</label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                {TASKS.map(t => (
                  <button key={t.id} onClick={() => setTask(t.id)} style={{
                    background: task === t.id ? "rgba(251,191,36,0.12)" : "rgba(255,255,255,0.03)",
                    border: `1px solid ${task === t.id ? "rgba(251,191,36,0.4)" : "rgba(255,255,255,0.06)"}`,
                    borderRadius: 8, padding: "8px 10px",
                    color: task === t.id ? "#fbbf24" : "#888",
                    fontSize: 12, fontWeight: task === t.id ? 600 : 400,
                    cursor: "pointer", textAlign: "left", transition: "all 0.15s ease", fontFamily: "'DM Sans', sans-serif",
                  }}>{t.icon} {t.label}</button>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, color: "#666", display: "block", marginBottom: 8 }}>
                Chunk Size — <span style={{ color: "#fbbf24" }}>{chunkSize} products</span>
              </label>
              <input type="range" min={5} max={50} step={5} value={chunkSize}
                onChange={e => setChunkSize(Number(e.target.value))}
                style={{ width: "100%", accentColor: "#fbbf24", cursor: "pointer" }} />
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#444", marginTop: 4 }}>
                <span>5</span><span>25</span><span>50</span>
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

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", background: dryRun ? "rgba(251,191,36,0.06)" : "rgba(239,68,68,0.06)", border: `1px solid ${dryRun ? "rgba(251,191,36,0.2)" : "rgba(239,68,68,0.2)"}`, borderRadius: 9, marginBottom: 20, cursor: "pointer" }} onClick={() => setDryRun(d => !d)}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: dryRun ? "#fbbf24" : "#f87171" }}>{dryRun ? "🔍 Dry Run Mode" : "⚡ Live Mode"}</div>
                <div style={{ fontSize: 11, color: "#555", marginTop: 2 }}>{dryRun ? "No writes — preview only" : "Will write to Shopify"}</div>
              </div>
              <div style={{ width: 36, height: 20, borderRadius: 10, background: dryRun ? "#fbbf24" : "#ef4444", position: "relative", transition: "background 0.2s" }}>
                <div style={{ position: "absolute", top: 2, left: dryRun ? 2 : 18, width: 16, height: 16, borderRadius: "50%", background: "#fff", transition: "left 0.2s" }} />
              </div>
            </div>

            <button onClick={runFix} disabled={running} style={{ width: "100%", background: running ? "#1a1a1a" : "linear-gradient(135deg, #fbbf24, #f59e0b)", border: "none", borderRadius: 10, padding: "13px 0", color: running ? "#444" : "#000", fontSize: 14, fontWeight: 700, cursor: running ? "not-allowed" : "pointer", fontFamily: "'DM Sans', sans-serif", transition: "all 0.2s ease", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
              {running ? <><span style={{ display: "inline-block", animation: "spin 0.8s linear infinite", fontSize: 16 }}>⟳</span>Processing…</> : `▶ Run${dryRun ? " (Dry Run)" : ""}`}
            </button>

            {nextOffset != null && !running && (
              <button onClick={() => { setOffset(nextOffset); setNextOffset(null); }} style={{ width: "100%", marginTop: 8, background: "rgba(96,165,250,0.1)", border: "1px solid rgba(96,165,250,0.3)", borderRadius: 10, padding: "11px 0", color: "#60a5fa", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "'DM Sans', sans-serif" }}>
                ↪ Continue from offset {nextOffset}
              </button>
            )}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ background: "#111", border: "1px solid #1e1e1e", borderRadius: 14, padding: 24, animation: "fadeIn 0.4s ease 0.15s both" }}>
              <div style={{ fontSize: 11, color: "#555", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 16 }}>Results</div>
              {stats ? (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  {Object.entries(STAT_LABELS).map(([key, label]) => (
                    <StatCard key={key} label={label} value={stats[key]} accent={key === "errors" && stats[key] > 0} />
                  ))}
                </div>
              ) : (
                <div style={{ height: 120, display: "flex", alignItems: "center", justifyContent: "center", color: "#333", fontSize: 13, fontStyle: "italic" }}>
                  {running ? <span style={{ animation: "pulse 1s ease infinite" }}>Running…</span> : "No run yet — configure and click Run"}
                </div>
              )}
            </div>

            <div style={{ background: "#111", border: "1px solid #1e1e1e", borderRadius: 14, padding: 16, animation: "fadeIn 0.4s ease 0.2s both" }}>
              <div style={{ fontSize: 11, color: "#555", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 10 }}>API URL</div>
              <div style={{ fontFamily: "monospace", fontSize: 11, color: "#60a5fa", background: "#0a0a0a", border: "1px solid #1a1a1a", borderRadius: 7, padding: "8px 12px", wordBreak: "break-all", lineHeight: 1.6 }}>
                /api/shopifyFix?task={task}&chunkSize={chunkSize}&offset={offset}{dryRun ? "&dryRun=true" : ""}
              </div>
            </div>

            {history.length > 0 && (
              <div style={{ background: "#111", border: "1px solid #1e1e1e", borderRadius: 14, padding: 16, animation: "fadeIn 0.3s ease" }}>
                <div style={{ fontSize: 11, color: "#555", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 10 }}>Run History</div>
                {history.map((h, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, fontFamily: "monospace", color: "#555", padding: "4px 0", borderBottom: i < history.length - 1 ? "1px solid #1a1a1a" : "none" }}>
                    <span>offset={h.offset} chunk={h.chunkSize} {h.dryRun ? "[dry]" : "[live]"}</span>
                    <span style={{ color: "#34d399" }}>✓ {h.stats?.scanned ?? 0} scanned</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div style={{ marginTop: 20, background: "#080808", border: "1px solid #1a1a1a", borderRadius: 14, overflow: "hidden", animation: "fadeIn 0.4s ease 0.25s both" }}>
          <div style={{ padding: "12px 20px", borderBottom: "1px solid #1a1a1a", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: running ? "#34d399" : log.length ? "#fbbf24" : "#333", animation: running ? "pulse 1s ease infinite" : "none" }} />
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

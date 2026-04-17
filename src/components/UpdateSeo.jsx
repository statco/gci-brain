import { useState, useRef, useEffect } from "react";

// ─── Stat Card ────────────────────────────────────────────────────────────────
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

// ─── Log Line ─────────────────────────────────────────────────────────────────
function LogLine({ line, index }) {
  const isError   = line.includes("❌") || line.includes("error");
  const isDone    = line.includes("✅ Done") || line.includes("✅ All") || line.includes("complete");
  const isHeader  = line.startsWith("▶") || line.startsWith("📦") || line.startsWith("🔍") || line.startsWith("📊");
  const isUpdated = line.includes("[updated]") || line.includes("✅");
  const isSkipped = line.includes("[skipped]") || line.includes("[dry-run]");
  const isSep     = line.includes("──────");
  const isAI      = line.includes("[ai]");

  const color = isError   ? "#f87171"
    : isDone    ? "#34d399"
    : isHeader  ? "#fbbf24"
    : isUpdated ? "#34d399"
    : isSkipped ? "#9ca3af"
    : isAI      ? "#a78bfa"
    : isSep     ? "#333"
    : "#9ca3af";

  return (
    <div style={{
      fontFamily: "'DM Mono', 'Courier New', monospace",
      fontSize: 12,
      color,
      lineHeight: 1.7,
      opacity: isHeader ? 1 : 0.88,
      fontWeight: isHeader || isDone ? 600 : 400,
      borderLeft: isUpdated || isSkipped ? `2px solid ${color}33` : "none",
      paddingLeft: isUpdated || isSkipped ? 8 : 0,
    }}>
      {line}
    </div>
  );
}

// ─── Preview Row ──────────────────────────────────────────────────────────────
function PreviewRow({ item }) {
  return (
    <div style={{
      borderBottom: "1px solid #1f2937",
      padding: "10px 0",
      fontSize: 12,
      fontFamily: "monospace",
    }}>
      <div style={{ color: "#f9fafb", marginBottom: 4, fontWeight: 600 }}>
        {item.title}
      </div>
      <div style={{ color: "#60a5fa", marginBottom: 2 }}>
        SEO: {item.seoTitle}
      </div>
      <div style={{ color: "#9ca3af" }}>
        Meta: {item.metaDescription}
      </div>
      {item.aiGenerated && (
        <div style={{ color: "#a78bfa", fontSize: 11, marginTop: 2 }}>✦ AI generated</div>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function UpdateSeo() {
  const [chunkSize,      setChunkSize]      = useState(15);
  const [offset,         setOffset]         = useState(0);
  const [dryRun,         setDryRun]         = useState(true);
  const [autoContinue,   setAutoContinue]   = useState(false);
  const [running,        setRunning]        = useState(false);
  const [isAutoRunning,  setIsAutoRunning]  = useState(false);
  const [log,            setLog]            = useState([]);
  const [preview,        setPreview]        = useState([]);
  const [cumulative,     setCumulative]     = useState({ updated: 0, skipped: 0, errors: 0, aiGenerated: 0 });
  const [lastSummary,    setLastSummary]    = useState(null);
  const [nextOffset,     setNextOffset]     = useState(null);
  const [done,           setDone]           = useState(false);
  const logRef           = useRef(null);
  const stopRef          = useRef(false);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);

  const addLog = (line) => setLog(l => [...l, line]);

  async function runUpdate() {
    const doAuto = autoContinue;
    stopRef.current = false;
    if (doAuto) setIsAutoRunning(true);

    let currentOffset = offset;
    let cum = { updated: 0, skipped: 0, errors: 0, aiGenerated: 0 };
    setCumulative(cum);
    setPreview([]);
    setDone(false);
    setNextOffset(null);

    setLog([`▶ Starting${dryRun ? " [DRY RUN]" : ""} — chunkSize=${chunkSize} offset=${currentOffset}…`]);
    setLastSummary(null);

    while (true) {
      setRunning(true);

      const params = new URLSearchParams({
        offset: String(currentOffset),
        chunkSize: String(chunkSize),
        ...(dryRun ? { dry: "true" } : {}),
      });

      let data;
      try {
        const res = await fetch(`/api/updateSeo?${params}`);
        if (!res.ok) throw new Error(`Server ${res.status}`);
        data = await res.json();
      } catch (err) {
        addLog(`❌ Fetch error: ${err.message}`);
        setRunning(false);
        setIsAutoRunning(false);
        return;
      }

      // Parse response
      const updated     = data.updated     ?? 0;
      const skipped     = data.skipped     ?? 0;
      const errors      = data.errors?.length ?? 0;
      const aiGenerated = data.changes?.filter(c => c.aiGenerated).length ?? 0;
      const nextOff     = data.nextOffset ?? null;
      const isDone      = data.done ?? (nextOff === null);

      // Accumulate
      cum = {
        updated:     cum.updated + updated,
        skipped:     cum.skipped + skipped,
        errors:      cum.errors + errors,
        aiGenerated: cum.aiGenerated + aiGenerated,
      };
      setCumulative({ ...cum });
      setLastSummary({ updated, skipped, errors, aiGenerated });
      setNextOffset(nextOff);

      // Log batch summary
      addLog(`──────────────────────────────`);
      addLog(`📊 Batch offset=${currentOffset} — updated:${updated} skipped:${skipped} errors:${errors} ai:${aiGenerated}`);

      // Show preview items (dry run)
      if (dryRun && data.changes?.length) {
        setPreview(p => [...p, ...data.changes].slice(0, 30));
        data.changes.forEach(c => {
          addLog(`  [${dryRun ? "dry-run" : "updated"}] ${c.title}`);
          addLog(`    SEO: ${c.seoTitle}`);
        });
      }

      // Log errors
      if (data.errors?.length) {
        data.errors.forEach(e => addLog(`  ❌ ${e}`));
      }

      if (isDone || updated === 0) {
        addLog(`──────────────────────────────`);
        addLog(`✅ Done — total updated:${cum.updated} skipped:${cum.skipped} ai:${cum.aiGenerated} errors:${cum.errors}`);
        setDone(true);
        setRunning(false);
        setIsAutoRunning(false);
        return;
      }

      if (!doAuto || stopRef.current) {
        addLog(`⏸ Paused — next chunk starts at offset=${nextOff}`);
        setOffset(nextOff ?? currentOffset + chunkSize);
        setRunning(false);
        setIsAutoRunning(false);
        return;
      }

      currentOffset = nextOff;
      setOffset(currentOffset);
      await new Promise(r => setTimeout(r, 400)); // small gap
    }
  }

  function stop() {
    stopRef.current = true;
    setIsAutoRunning(false);
  }

  function reset() {
    setOffset(0);
    setLog([]);
    setPreview([]);
    setCumulative({ updated: 0, skipped: 0, errors: 0, aiGenerated: 0 });
    setLastSummary(null);
    setNextOffset(null);
    setDone(false);
    stopRef.current = false;
  }

  const canRun = !running;

  return (
    <div style={{
      minHeight: "100vh",
      background: "#0f172a",
      color: "#f9fafb",
      fontFamily: "'Inter', system-ui, sans-serif",
      padding: "32px 24px",
    }}>
      {/* Header */}
      <div style={{ maxWidth: 900, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 8 }}>
          <a href="/brain" style={{ color: "#6b7280", textDecoration: "none", fontSize: 13 }}>
            ← Brain
          </a>
        </div>
        <h1 style={{ fontSize: 26, fontWeight: 700, margin: 0, color: "#f9fafb" }}>
          🔍 Update Product SEO
        </h1>
        <p style={{ color: "#6b7280", fontSize: 14, marginTop: 6 }}>
          Writes English SEO titles and meta descriptions to all products.
          Format: <span style={{ color: "#60a5fa", fontFamily: "monospace" }}>[Title] | GCI Tires</span> and
          <span style={{ color: "#60a5fa", fontFamily: "monospace" }}> Shop the [Title] at GCI Tires…</span>
        </p>

        {/* API URL */}
        <div style={{ background: "#1e293b", borderRadius: 6, padding: "8px 14px", fontSize: 12, fontFamily: "monospace", color: "#94a3b8", marginBottom: 24 }}>
          /api/updateSeo?chunkSize={chunkSize}&offset={offset}{dryRun ? "&dry=true" : ""}
        </div>

        {/* Controls */}
        <div style={{
          background: "#1e293b",
          borderRadius: 12,
          padding: 20,
          marginBottom: 24,
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 16,
        }}>
          {/* Left: settings */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <label style={{ fontSize: 13, color: "#9ca3af" }}>
              Chunk size
              <input
                type="number" min={1} max={50} value={chunkSize}
                onChange={e => setChunkSize(Number(e.target.value))}
                disabled={running}
                style={{ marginLeft: 10, width: 60, background: "#0f172a", border: "1px solid #374151", borderRadius: 6, color: "#f9fafb", padding: "4px 8px", fontSize: 13 }}
              />
            </label>
            <label style={{ fontSize: 13, color: "#9ca3af" }}>
              Start offset
              <input
                type="number" min={0} value={offset}
                onChange={e => setOffset(Number(e.target.value))}
                disabled={running}
                style={{ marginLeft: 10, width: 70, background: "#0f172a", border: "1px solid #374151", borderRadius: 6, color: "#f9fafb", padding: "4px 8px", fontSize: 13 }}
              />
            </label>
          </div>

          {/* Right: toggles */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: "#9ca3af", cursor: "pointer" }}>
              <input
                type="checkbox" checked={dryRun}
                onChange={e => setDryRun(e.target.checked)}
                disabled={running}
                style={{ width: 16, height: 16, accentColor: "#60a5fa" }}
              />
              <span>Dry Run <span style={{ color: "#4b5563" }}>(preview only)</span></span>
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: "#9ca3af", cursor: "pointer" }}>
              <input
                type="checkbox" checked={autoContinue}
                onChange={e => setAutoContinue(e.target.checked)}
                disabled={running}
                style={{ width: 16, height: 16, accentColor: "#34d399" }}
              />
              <span>Auto-continue <span style={{ color: "#4b5563" }}>(run all chunks)</span></span>
            </label>
          </div>
        </div>

        {/* Buttons */}
        <div style={{ display: "flex", gap: 12, marginBottom: 24 }}>
          <button
            onClick={runUpdate}
            disabled={!canRun}
            style={{
              background: dryRun ? "#1d4ed8" : "#15803d",
              color: "white",
              border: "none",
              borderRadius: 8,
              padding: "10px 22px",
              fontSize: 14,
              fontWeight: 600,
              cursor: canRun ? "pointer" : "not-allowed",
              opacity: canRun ? 1 : 0.5,
            }}
          >
            {running ? "Running…" : dryRun ? "▶ Preview (Dry Run)" : "▶ Run (Live)"}
          </button>

          {isAutoRunning && (
            <button
              onClick={stop}
              style={{ background: "#7f1d1d", color: "white", border: "none", borderRadius: 8, padding: "10px 22px", fontSize: 14, fontWeight: 600, cursor: "pointer" }}
            >
              ⏹ Stop
            </button>
          )}

          <button
            onClick={reset}
            disabled={running}
            style={{ background: "#1e293b", color: "#9ca3af", border: "1px solid #374151", borderRadius: 8, padding: "10px 22px", fontSize: 14, cursor: running ? "not-allowed" : "pointer" }}
          >
            Reset
          </button>
        </div>

        {/* Stats */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 24 }}>
          <StatCard label="Updated"     value={cumulative.updated}     color="#34d399" />
          <StatCard label="Skipped"     value={cumulative.skipped}     color="#9ca3af" />
          <StatCard label="AI Generated" value={cumulative.aiGenerated} color="#a78bfa" />
          <StatCard label="Errors"      value={cumulative.errors}      color="#f87171" />
        </div>

        {/* Done banner */}
        {done && (
          <div style={{ background: "#14532d", border: "1px solid #16a34a", borderRadius: 8, padding: "12px 18px", marginBottom: 20, fontSize: 14, color: "#86efac" }}>
            ✅ All products processed — {cumulative.updated} SEO records written, {cumulative.aiGenerated} AI-generated
          </div>
        )}

        {/* Next offset hint */}
        {nextOffset !== null && !done && !running && (
          <div style={{ background: "#1e3a5f", border: "1px solid #2563eb", borderRadius: 8, padding: "10px 16px", marginBottom: 20, fontSize: 13, color: "#93c5fd" }}>
            ⏸ Next chunk starts at offset <strong>{nextOffset}</strong> — click Run to continue
          </div>
        )}

        {/* Preview grid (dry run) */}
        {dryRun && preview.length > 0 && (
          <div style={{ background: "#1e293b", borderRadius: 10, padding: 16, marginBottom: 24 }}>
            <div style={{ fontSize: 13, color: "#9ca3af", marginBottom: 12, fontWeight: 600 }}>
              PREVIEW ({preview.length} products)
            </div>
            {preview.map((item, i) => <PreviewRow key={i} item={item} />)}
          </div>
        )}

        {/* Log */}
        {log.length > 0 && (
          <div style={{ background: "#1e293b", borderRadius: 10, padding: 16 }}>
            <div style={{ fontSize: 11, color: "#4b5563", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.08em" }}>
              Console Output
              <button
                onClick={() => setLog([])}
                style={{ marginLeft: 12, background: "none", border: "none", color: "#4b5563", cursor: "pointer", fontSize: 11 }}
              >
                clear
              </button>
            </div>
            <div
              ref={logRef}
              style={{ maxHeight: 400, overflowY: "auto", display: "flex", flexDirection: "column", gap: 1 }}
            >
              {log.map((line, i) => <LogLine key={i} line={line} index={i} />)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

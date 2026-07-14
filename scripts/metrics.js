// Readability metrics: before/after comparison with HTML report
const { parser, t, fs, path } = require("./config");

function analyze(filepath) {
  const code = fs.readFileSync(filepath, "utf-8");
  let ast;
  try {
    ast = parser.parse(code, {
      sourceType: "script",
      allowReturnOutsideFunction: true,
      allowUndeclaredExports: true,
      errorRecovery: true,
    });
  } catch (e) {
    return analyzeFallback(filepath, code);
  }

  const result = walkAST(ast);
  result.file = filepath;
  result.size = code.length;
  result.lines = code.split("\n").length;
  result.sizeMB = (result.size / 1024 / 1024);
  return result;
}

function walkAST(ast) {
  const m = { fnCount: 0, maxDepth: 0, maxBodyLen: 0, totalBodyLen: 0, totalParams: 0, fnWithComments: 0 };

  function walk(node, depth) {
    if (!node || typeof node !== "object") return;
    if (
      t.isFunctionDeclaration(node) || t.isFunctionExpression(node) ||
      t.isArrowFunctionExpression(node) || t.isObjectMethod(node)
    ) {
      m.fnCount++;
      const bl = t.isBlockStatement(node.body) ? node.body.body.length : 1;
      m.totalBodyLen += bl;
      m.totalParams += node.params.length;
      if (bl > m.maxBodyLen) m.maxBodyLen = bl;
      if (depth > m.maxDepth) m.maxDepth = depth;
      if (node.leadingComments && node.leadingComments.length > 0) m.fnWithComments++;
    }
    for (const k of Object.keys(node)) {
      if (k === "start" || k === "end" || k === "loc" ||
          k.startsWith("lead") || k.startsWith("trail") || k.startsWith("inner")) continue;
      const v = node[k];
      if (Array.isArray(v)) { for (const x of v) walk(x, depth + 1); }
      else if (v && typeof v.type === "string") walk(v, depth + 1);
    }
  }
  walk(ast, 0);
  m.avgBodyLen = (m.totalBodyLen / Math.max(1, m.fnCount));
  m.avgParams = (m.totalParams / Math.max(1, m.fnCount));
  return m;
}

function analyzeFallback(filepath, code) {
  const fnMatches = code.match(/\bfunction\s/g) || [];
  const commentMatches = code.match(/\/\/\s*Original lines/g) || [];
  const lines = code.split("\n");
  let maxIndent = 0;
  for (const line of lines) {
    const indent = line.match(/^(\s*)/)[1].length;
    if (indent > maxIndent) maxIndent = Math.min(indent, 200);
  }
  return {
    file: filepath, size: code.length, sizeMB: code.length / 1024 / 1024,
    lines: lines.length, fnCount: fnMatches.length,
    maxDepth: Math.round(maxIndent / 2), maxBodyLen: 0, avgBodyLen: 0,
    avgParams: 0, fnWithComments: commentMatches.length,
    totalBodyLen: 0, totalParams: 0, fallback: true,
  };
}

function generateReport(before, after) {
  const metrics = [
    { label: "Functions", before: before.fnCount, after: after.fnCount, fmt: 0, better: "higher" },
    { label: "Avg Function Body", before: before.avgBodyLen, after: after.avgBodyLen, fmt: 1, better: "lower", unit: "lines" },
    { label: "Max Nesting Depth", before: before.maxDepth, after: after.maxDepth, fmt: 0, better: "lower" },
    { label: "Functions w/ Comments", before: before.fnWithComments, after: after.fnWithComments, fmt: 0, better: "higher" },
    { label: "Avg Parameters", before: before.avgParams, after: after.avgParams, fmt: 1, better: "higher" },
    { label: "File Size", before: before.sizeMB, after: after.sizeMB, fmt: 2, better: "lower", unit: "MB" },
    { label: "Total Lines", before: before.lines, after: after.lines, fmt: 0, better: "higher" },
    { label: "Max Function Body", before: before.maxBodyLen, after: after.maxBodyLen, fmt: 0, better: "lower", unit: "lines" },
  ];

  const labels = metrics.map((m) => m.label);

  // Normalize: before = 100, chart shows deviation from 100%
  // Increase = green bar above baseline, decrease = red bar below baseline
  const chartData = metrics.map((m) => {
    if (m.before === 0) {
      // When Before is 0, After being >0 is a new addition (cap at +100%)
      return m.after > 0 ? 100 : 0;
    }
    const raw = (m.after / m.before) * 100;
    return raw - 100;
  });
  const chartColors = chartData.map((v) => v > 0 ? "#22c55e" : v < 0 ? "#ef4444" : "#64748b");

  const rows = metrics.map((m) => {
    const delta = m.after - m.before;
    const same = delta === 0;
    const bVal = m.before.toFixed(m.fmt);
    const aVal = m.after.toFixed(m.fmt);
    const pct = m.before > 0 ? ((delta / m.before) * 100) : 0;
    const pctStr = (pct > 0 ? "+" : "") + pct.toFixed(0) + "%";

    const clazz = same ? "eq" : delta > 0 ? "up" : "down";
    const dir = same ? "-- unchanged" : delta > 0 ? "↑ increase" : "↓ decrease";

    return {
      label: m.label, bVal, aVal, unit: m.unit || "",
      dir, clazz, pct: pctStr,
    };
  });

  const increased = rows.filter((r) => r.clazz === "up").length;
  const decreased = rows.filter((r) => r.clazz === "down").length;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>deob · Readability Report</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.8/dist/chart.umd.min.js"></script>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:system-ui,-apple-system,sans-serif;background:#0f172a;color:#e2e8f0;min-height:100vh}
  .wrap{max-width:840px;margin:0 auto;padding:48px 24px}
  h1{font-size:26px;font-weight:700;letter-spacing:-.5px;margin-bottom:4px}
  h1 span{color:#6366f1}
  .path{color:#64748b;font-size:13px;font-family:ui-monospace,monospace}
  .header{margin-bottom:32px}
  .kpi{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:36px}
  .kpi-card{background:linear-gradient(135deg,#1e293b,#1a2332);border-radius:12px;padding:22px;border:1px solid #1e293b;text-align:center}
  .kpi-card .val{font-size:38px;font-weight:800;line-height:1}
  .val.g{color:#22c55e} .val.i{color:#6366f1} .val.w{color:#f59e0b}
  .kpi-card .lbl{font-size:12px;color:#64748b;margin-top:6px;text-transform:uppercase;letter-spacing:.5px}
  .chart-box{background:#1e293b;border-radius:12px;padding:24px;border:1px solid #1e293b;margin-bottom:36px}
  .chart-box canvas{max-height:340px}
  .sec{font-size:11px;font-weight:600;color:#475569;text-transform:uppercase;letter-spacing:1px;margin-bottom:12px}
  .list{display:flex;flex-direction:column;gap:6px}
  .row{background:#1e293b;border-radius:10px;padding:14px 18px;display:flex;align-items:center;gap:14px;border:1px solid transparent;transition:border-color .2s}
  .row:hover{border-color:#334155}
  .row-label{flex:1;font-size:14px;color:#cbd5e1}
  .row-vals{display:flex;align-items:center;gap:10px;font-size:13px;font-variant-numeric:tabular-nums}
  .row-vals .bf{color:#64748b}.row-vals .ar{color:#e2e8f0;font-weight:600}.row-vals .arr{color:#475569}
  .tag{font-size:12px;font-weight:600;min-width:100px;text-align:right}
  .tag.up{color:#22c55e}.tag.down{color:#ef4444}.tag.eq{color:#64748b}
  .foot{text-align:center;color:#475569;font-size:12px;margin-top:40px}
  .foot a{color:#6366f1;text-decoration:none}
</style>
</head>
<body>
<div class="wrap">
  <div class="header">
    <h1>deob <span>·</span> Readability Report</h1>
    <div class="path">${before.file} → ${after.file}${before.fallback ? "  (regex-based)" : ""}</div>
  </div>
  <div class="kpi">
    <div class="kpi-card"><div class="val g">${increased}</div><div class="lbl">Increase</div></div>
    <div class="kpi-card"><div class="val i">${decreased}</div><div class="lbl">Decrease</div></div>
    <div class="kpi-card"><div class="val w">${after.fnCount}</div><div class="lbl">Functions</div></div>
  </div>
  <div class="chart-box">
    <div class="sec">Change from Baseline (Before = 100%)</div>
    <canvas id="chart"></canvas>
  </div>
  <div class="sec">Details</div>
  <div class="list">
${rows.map((r) => `
    <div class="row">
      <div class="row-label">${r.label}</div>
      <div class="row-vals"><span class="bf">${r.bVal}${r.unit}</span><span class="arr">→</span><span class="ar">${r.aVal}${r.unit}</span></div>
      <div class="tag ${r.clazz === 'up' ? 'up' : r.clazz === 'down' ? 'down' : 'eq'}">${r.pct} ${r.dir}</div>
    </div>`).join("")}
  </div>
  <div class="foot">Generated by <a href="#">deob</a> · ${new Date().toISOString().slice(0, 10)}</div>
</div>
<script>
new Chart(document.getElementById('chart'), {
  type: 'bar',
  data: {
    labels: ${JSON.stringify(labels)},
    datasets: [{
      data: ${JSON.stringify(chartData)},
      backgroundColor: ${JSON.stringify(chartColors)},
      borderRadius: 4,
      borderSkipped: false,
    }]
  },
  options: {
    responsive: true,
    plugins: {
      legend: { display: false },
      tooltip: { callbacks: { label: (ctx) => (ctx.raw > 0 ? '+' : '') + ctx.raw.toFixed(1) + '%' } }
    },
    scales: {
      x: { ticks: { color:'#64748b', font:{size:11}, maxRotation:45, minRotation:0 }, grid:{color:'#1e293b'} },
      y: { ticks: { color:'#64748b', callback: (v) => (v > 0 ? '+' : '') + v + '%' }, grid:{color:'#1e293b'} }
    }
  }
});
</script>
</body>
</html>`;
}

function runMetrics(input, output) {
  console.log("Analyzing before/after metrics...");
  const before = analyze(input);
  const after = analyze(output);
  const html = generateReport(before, after);
  const outPath = output.endsWith(".js")
    ? output.replace(/\.js$/, ".metrics.html")
    : output + "/metrics.html";
  fs.writeFileSync(outPath, html, "utf-8");
  console.log(`  Report: ${outPath}`);
  return { before, after };
}

module.exports = { analyze, generateReport, runMetrics };

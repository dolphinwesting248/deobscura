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
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
  body{font-family:system-ui,-apple-system,sans-serif;background:#0d1117;color:#e6edf3;line-height:1.5;-webkit-font-smoothing:antialiased}
  .page{max-width:800px;margin:0 auto;padding:64px 28px 48px}
  /* --- Header --- */
  .head{margin-bottom:44px}
  .head-title{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:22px;font-weight:600;color:#e6edf3;letter-spacing:-.3px}
  .head-title em{font-style:normal;color:#8b949e}
  .head-path{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12px;color:#484f58;margin-top:6px}
  /* --- KPIs --- */
  .kpis{display:flex;gap:1px;background:#21262d;border-radius:8px;overflow:hidden;margin-bottom:44px}
  .kpi{flex:1;background:#161b22;padding:20px 24px;text-align:center}
  .kpi-val{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:36px;font-weight:500;line-height:1;letter-spacing:-1px;font-variant-numeric:tabular-nums}
  .kpi-val.g{color:#3fb950}.kpi-val.r{color:#f85149}.kpi-val.b{color:#58a6ff}
  .kpi-lbl{font-size:11px;color:#8b949e;margin-top:6px;text-transform:uppercase;letter-spacing:.6px;font-weight:500}
  /* --- Chart --- */
  .chart-wrap{background:#161b22;border:1px solid #21262d;border-radius:8px;padding:28px 24px 20px;margin-bottom:44px}
  .chart-title{font-size:11px;font-weight:600;color:#8b949e;text-transform:uppercase;letter-spacing:.8px;margin-bottom:16px}
  .chart-wrap canvas{max-height:320px}
  /* --- Table --- */
  .sec-title{font-size:11px;font-weight:600;color:#8b949e;text-transform:uppercase;letter-spacing:.8px;margin-bottom:14px}
  .tbl{width:100%;border-collapse:collapse}
  .tbl th{text-align:left;font-size:11px;font-weight:500;color:#484f58;padding:0 12px 8px;border-bottom:1px solid #21262d}
  .tbl th:last-child,.tbl td:last-child{text-align:right}
  .tbl td{padding:10px 12px;font-size:13px;border-bottom:1px solid #161b22;font-variant-numeric:tabular-nums}
  .tbl tr:hover td{background:#161b22}
  .tbl .name{color:#e6edf3;font-weight:500}
  .tbl .bf{color:#8b949e;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12px}
  .tbl .af{color:#e6edf3;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12px}
  .tbl .arr{color:#30363d;margin:0 6px}
  .tbl .tag{font-size:12px;font-weight:600}
  .tbl .tag.up{color:#3fb950}.tbl .tag.down{color:#f85149}.tbl .tag.eq{color:#484f58}
  /* --- Footer --- */
  .foot{margin-top:40px;text-align:center;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:11px;color:#21262d}
</style>
</head>
<body>
<div class="page">
  <div class="head">
    <div class="head-title">deob <em>metrics</em></div>
    <div class="head-path">${before.file} → ${after.file}${before.fallback ? "  (regex-based)" : ""}</div>
  </div>

  <div class="kpis">
    <div class="kpi"><div class="kpi-val g">${increased}</div><div class="kpi-lbl">increased</div></div>
    <div class="kpi"><div class="kpi-val r">${decreased}</div><div class="kpi-lbl">decreased</div></div>
    <div class="kpi"><div class="kpi-val b">${after.fnCount}</div><div class="kpi-lbl">functions</div></div>
  </div>

  <div class="chart-wrap">
    <div class="chart-title">Deviation from baseline · Before = 100%</div>
    <canvas id="chart"></canvas>
  </div>

  <div class="sec-title">Detail</div>
  <table class="tbl">
    <thead><tr><th>Metric</th><th colspan="2">Value</th><th>Change</th></tr></thead>
    <tbody>
${rows.map((r) => `
      <tr>
        <td class="name">${r.label}</td>
        <td class="bf">${r.bVal}${r.unit}</td>
        <td><span class="arr">→</span><span class="af">${r.aVal}${r.unit}</span></td>
        <td class="tag ${r.clazz === 'up' ? 'up' : r.clazz === 'down' ? 'down' : 'eq'}">${r.pct} ${r.dir}</td>
      </tr>`).join("")}
    </tbody>
  </table>

  <div class="foot">deob · ${new Date().toISOString().slice(0, 10)}</div>
</div>
<script>
new Chart(document.getElementById('chart'), {
  type: 'bar',
  data: {
    labels: ${JSON.stringify(labels)},
    datasets: [{
      data: ${JSON.stringify(chartData)},
      backgroundColor: ${JSON.stringify(chartColors)},
      borderRadius: {topLeft:3,topRight:3,bottomLeft:0,bottomRight:0},
      borderSkipped: false,
      barPercentage: .7,
    }]
  },
  options: {
    responsive:true,
    interaction:{intersect:false,mode:'index'},
    plugins:{legend:{display:false},tooltip:{backgroundColor:'#161b22',titleColor:'#8b949e',bodyColor:'#e6edf3',bodyFont:{family:'ui-monospace,monospace',size:13},padding:10,cornerRadius:6,callbacks:{label:(c)=>(c.raw>0?'+':'')+c.raw.toFixed(1)+'%'}}},
    scales:{
      x:{ticks:{color:'#8b949e',font:{size:10},maxRotation:45,minRotation:0},grid:{color:'#21262d',drawBorder:false}},
      y:{position:'right',ticks:{color:'#8b949e',font:{size:10,family:'ui-monospace,monospace'},callback:(v)=>(v>0?'+':'')+v+'%',stepSize:20},grid:{color:'#21262d',drawBorder:false},border:{dash:[3,3]}}
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

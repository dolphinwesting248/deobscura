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
    // Fallback: regex-based analysis for files with sloppy-mode reserved words (let/if as variable names)
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
  // Regex-based analysis for files that Babel can't parse (sloppy-mode reserved words)
  const fnMatches = code.match(/\bfunction\s/g) || [];
  const commentMatches = code.match(/\/\/\s*Original lines/g) || [];
  const lines = code.split("\n");

  // Estimate nesting depth from indentation
  let maxIndent = 0;
  for (const line of lines) {
    const indent = line.match(/^(\s*)/)[1].length;
    if (indent > maxIndent) maxIndent = Math.min(indent, 200);
  }
  const maxDepth = Math.round(maxIndent / 2);

  return {
    file: filepath,
    size: code.length,
    sizeMB: code.length / 1024 / 1024,
    lines: lines.length,
    fnCount: fnMatches.length,
    maxDepth: maxDepth,
    maxBodyLen: 0,
    avgBodyLen: 0,
    avgParams: 0,
    fnWithComments: commentMatches.length,
    totalBodyLen: 0,
    totalParams: 0,
    fallback: true,
  };
}

function generateReport(before, after) {
  const metrics = [
    { label: "文件大小 (MB)", before: before.sizeMB, after: after.sizeMB, fmt: 2, better: "lower" },
    { label: "总行数", before: before.lines, after: after.lines, fmt: 0, better: "higher" },
    { label: "函数数量", before: before.fnCount, after: after.fnCount, fmt: 0, better: "higher" },
    { label: "最大嵌套深度", before: before.maxDepth, after: after.maxDepth, fmt: 0, better: "lower" },
    { label: "最大函数体(行)", before: before.maxBodyLen, after: after.maxBodyLen, fmt: 0, better: "lower" },
    { label: "平均函数体(行)", before: before.avgBodyLen, after: after.avgBodyLen, fmt: 1, better: "lower" },
    { label: "平均参数数", before: before.avgParams, after: after.avgParams, fmt: 1, better: "higher" },
    { label: "带注释的函数", before: before.fnWithComments, after: after.fnWithComments, fmt: 0, better: "higher" },
  ];

  const maxVal = Math.max(...metrics.flatMap((m) => [m.before, m.after]));
  const barWidth = 350;
  const bars = metrics.map((m, i) => {
    const bPct = Math.round((m.before / maxVal) * barWidth);
    const aPct = Math.round((m.after / maxVal) * barWidth);
    const delta = m.after - m.before;
    const deltaPct = m.before > 0 ? ((delta / m.before) * 100).toFixed(0) : "N/A";
    const isGood = (m.better === "higher" && delta > 0) || (m.better === "lower" && delta < 0);
    const color = isGood ? "#22c55e" : "#ef4444";
    const bVal = m.before.toFixed(m.fmt);
    const aVal = m.after.toFixed(m.fmt);
    const sign = delta > 0 ? "+" : "";
    return `
    <tr>
      <td>${m.label}</td>
      <td class="num">${bVal}</td>
      <td>
        <div class="bar-container">
          <div class="bar before" style="width:${bPct}px">${bVal}</div>
        </div>
      </td>
      <td class="num">${aVal}</td>
      <td>
        <div class="bar-container">
          <div class="bar after" style="width:${aPct}px">${aVal}</div>
        </div>
      </td>
      <td style="color:${color};font-weight:600">${sign}${delta.toFixed(m.fmt)} (${sign}${deltaPct}%)</td>
    </tr>`;
  }).join("\n");

  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<title>Deobfuscation Metrics Report</title>
<style>
  body { font-family: -apple-system, Segoe UI, sans-serif; max-width:960px; margin:40px auto; padding:0 20px; color:#1e293b; background:#f8fafc; }
  h1 { font-size:24px; margin-bottom:4px; }
  .sub { color:#64748b; margin-bottom:24px; }
  table { width:100%; border-collapse:collapse; background:#fff; border-radius:8px; overflow:hidden; box-shadow:0 1px 3px rgba(0,0,0,.08); }
  th { background:#f1f5f9; padding:10px 14px; text-align:left; font-size:13px; color:#475569; }
  td { padding:10px 14px; border-bottom:1px solid #f1f5f9; font-size:14px; }
  .num { text-align:right; font-variant-numeric:tabular-nums; min-width:60px; }
  .bar-container { background:#f1f5f9; border-radius:3px; width:360px; height:20px; position:relative; }
  .bar { height:100%; border-radius:3px; display:flex; align-items:center; padding-left:6px; font-size:11px; color:#fff; font-weight:600; min-width:40px; }
  .bar.before { background:#94a3b8; }
  .bar.after { background:#3b82f6; }
  .summary { display:grid; grid-template-columns:repeat(3,1fr); gap:16px; margin-bottom:32px; }
  .card { background:#fff; border-radius:8px; padding:20px; box-shadow:0 1px 3px rgba(0,0,0,.08); text-align:center; }
  .card .value { font-size:36px; font-weight:700; }
  .card .label { font-size:13px; color:#64748b; margin-top:4px; }
  .green { color:#22c55e; }
  .blue { color:#3b82f6; }
  .legend { display:flex; gap:20px; margin-bottom:12px; font-size:13px; }
  .legend span { display:flex; align-items:center; gap:6px; }
  .legend .swatch { width:14px; height:14px; border-radius:3px; }
</style>
</head>
<body>
<h1>Deobfuscation Metrics Report</h1>
<div class="sub">${before.file} → ${after.file}${before.fallback ? " (metrics are regex-based estimates)" : ""}</div>

<div class="summary">
  <div class="card">
    <div class="value green">${after.fnCount}</div>
    <div class="label">函数数量</div>
  </div>
  <div class="card">
    <div class="value blue">${after.fnWithComments}</div>
    <div class="label">带注释的函数</div>
  </div>
  <div class="card">
    <div class="value" style="color:#1e293b">${before.maxDepth} → ${after.maxDepth}</div>
    <div class="label">最大嵌套深度</div>
  </div>
</div>

<div class="legend">
  <span><div class="swatch" style="background:#94a3b8"></div> Before</span>
  <span><div class="swatch" style="background:#3b82f6"></div> After</span>
</div>

<table>
<tr><th>指标</th><th>之前</th><th></th><th>之后</th><th></th><th>Δ</th></tr>
${bars}
</table>

<p style="text-align:center;color:#94a3b8;margin-top:28px;font-size:12px">
  Generated by deob metrics &mdash; ${new Date().toISOString().slice(0, 10)}
</p>
</body>
</html>`;
}

function runMetrics(input, output) {
  console.log("Analyzing before/after metrics...");
  const before = analyze(input);
  const after = analyze(output);
  const reportPath = output.replace(/\.deob\.js$/, ".deob") + "/metrics.html";
  const html = generateReport(before, after);

  // Write alongside output (or as single file if not split)
  const outPath = output.endsWith(".js")
    ? output.replace(/\.js$/, ".metrics.html")
    : output + "/metrics.html";
  fs.writeFileSync(outPath, html, "utf-8");
  console.log(`  Report: ${outPath}`);
  return { before, after };
}

module.exports = { analyze, generateReport, runMetrics };

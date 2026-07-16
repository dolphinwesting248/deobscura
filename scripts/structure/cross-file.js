// Cross-file operations: summary, readme, file classification
const { fs, path } = require("../config");
const { classifyDomain, computeDensity, categorizeFn } = require("./analyze");

// ── Cross-File Summary ──────────────────────────────────────────────

function classifyFileType(report) {
  if (report.summary.totalFunctions === 0) {
    if (report.summary.originalFunctions === 0) return "proxy";
    return "single-export";
  }
  if (report.summary.subFunctions === 0 && report.summary.originalFunctions === 1) return "single-fn";
  return "module";
}

// ── Cross-File Prompt ──────────────────────────────────────────────

function writeCrossReadme(outputDir, allReports) {
  if (!allReports || allReports.length === 0) return;
  const lines = [];

  const sorted = [...allReports].sort((a, b) => {
    const sa = (a.report.alerts?.length || 0) * 2 + (a.report.summary.totalFunctions || 0);
    const sb = (b.report.alerts?.length || 0) * 2 + (b.report.summary.totalFunctions || 0);
    return sb - sa;
  });

  const totalFns = sorted.reduce((s, r) => s + r.report.summary.totalFunctions, 0);
  const totalAlerts = sorted.reduce((s, r) => s + (r.report.alerts || []).length, 0);
  const skipFiles = sorted.filter(r => r.report.summary.totalFunctions === 0).length;

  lines.push(`You are analyzing deobfuscated JavaScript across **${allReports.length} files**. The preprocessor already determined:`);
  lines.push("");
  lines.push(`## Architecture`);
  lines.push(`- ${totalFns} total functions across ${allReports.length} files`);
  lines.push(`- ${totalAlerts} total alerts across ${totalFns > 0 ? allReports.filter(r => (r.report.alerts||[]).length > 0).length : 0} files`);
  if (skipFiles > 0) lines.push(`- ${skipFiles} proxy/empty file${skipFiles > 1 ? "s" : ""} — skip`);
  lines.push("");

  lines.push("## Files (priority order)");
  lines.push("");
  lines.push("| # | File | Fns | Alerts | Action |");
  lines.push("|---|------|-----|--------|--------|");
  for (let i = 0; i < sorted.length; i++) {
    const r = sorted[i];
    const name = r.file;
    const total = r.report.summary.totalFunctions;
    const alerts = (r.report.alerts || []).length;
    const src = r.srcPath || "";
    const action = total === 0 ? "Skip" : alerts > 0 ? "**Read first**" : total > 20 ? "Read" : "Optional";
    lines.push(`| ${i + 1} | \`${name}\`${src ? " (" + src + ")" : ""} | ${total} | ${alerts} | ${action} |`);
  }
  lines.push("");

  lines.push("## Reading Path");
  lines.push("");
  lines.push("1. Pick a file from the table above (start with **Read first** entries)");
  lines.push("2. Enter its subdirectory");
  lines.push("3. Read `0-prompt.md` → `1-structure.md` → `2-index.txt` → jump to `main.js`");
  lines.push("4. Repeat for each file you need");
  lines.push("");
  lines.push("*Data reference: see `summary.md` for cross-file hotspots and keyword index.*");

  const outPath = path.join(outputDir, "0-prompt.md");
  fs.writeFileSync(outPath, lines.join("\n"), "utf-8");
  console.log(`  0-prompt: ${outPath}`);
}

function generateCrossSummary(results) {
  const hasSrcPaths = results.some((r) => r.srcPath);
  const files = results.map((r) => ({
    name: r.file,
    src: r.srcPath || r.file + ".js",
    type: classifyFileType(r.report),
    total: r.report.summary.totalFunctions,
    sub: r.report.summary.subFunctions,
    orig: r.report.summary.originalFunctions,
    alerts: (r.report.alerts || []).length,
  }));

  const dirName = path.basename(results[0]?.report?.file || "output");

  const allMostCalled = [];
  const allRoots = [];
  const allAlerts = [];
  for (const r of results) {
    const rep = r.report;
    for (const mc of (rep.hotspots?.mostCalled || [])) {
      allMostCalled.push({ file: r.file, name: mc.name, callers: mc.calledBy?.length || 0 });
    }
    for (const root of (rep.hotspots?.roots || [])) {
      allRoots.push({ file: r.file, name: root.name });
    }
    for (const a of (rep.alerts || [])) {
      allAlerts.push({ file: r.file, fn: a.fn, line: a.line, label: a.label, severity: a.severity, matches: a.matches });
    }
  }
  allMostCalled.sort((a, b) => b.callers - a.callers);

  const globalLookup = new Map();
  for (const r of results) {
    for (const [word, fns] of (r.report.lookup || [])) {
      if (!globalLookup.has(word)) globalLookup.set(word, []);
      const entry = globalLookup.get(word);
      for (const fn of fns) {
        if (!entry.includes(`${r.file}/${fn}`)) entry.push(`${r.file}/${fn}`);
      }
    }
  }
  // Filter out common stopwords that pollute the lookup
  const LOOKUP_STOP = new Set([
    "is", "call", "try", "set", "create", "object", "array", "string",
    "number", "function", "type", "value", "key", "index", "length",
    "data", "result", "error", "event", "target", "source", "name",
    "get", "has", "new", "init", "this", "that", "self",
    "read", "write", "int", "compare", "base", "buffer", "method",
    "branch", "listener", "use", "cache", "support", "return",
  ]);
  const topLookup = [...globalLookup.entries()]
    .filter(([word, fns]) => fns.length >= 2 && !LOOKUP_STOP.has(word) &&
      !/^ln\d+$/.test(word) && !/^[0-9a-fA-F]{4,}$/.test(word) && fns.length <= 80)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 15);

  // Add alert-relevant keywords that might have been filtered out
  const alertWords = new Set();
  for (const a of allAlerts) {
    for (const m of (a.matches || [])) {
      const w = m.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
      if (w.length > 3) alertWords.add(w);
    }
  }
  const alertLookup = [...globalLookup.entries()]
    .filter(([w]) => alertWords.has(w))
    .slice(0, 5);

  return `# Cross-File Summary · ${dirName}

## Keyword Index

${topLookup.length > 0 ? `| Word | Files & Functions |
|------|-------------------|
${topLookup.map(([word, fns]) => `| \`${word}\` | ${fns.slice(0, 5).map((f) => `\`${f}\``).join(" · ")}${fns.length > 5 ? ` _+${fns.length - 5} more_` : ""} |`).join("\n")}
${alertLookup.length > 0 ? `| **alert:** | |
${alertLookup.map(([word, fns]) => `| \`${word}\` | ${fns.slice(0, 5).map((f) => `\`${f}\``).join(" · ")}${fns.length > 5 ? ` _+${fns.length - 5} more_` : ""} |`).join("\n")}
` : ""}` : "_No significant keywords found._\n"}

## Cross-File Alerts

${allAlerts.length === 0 ? "_No alerts across files._\n" : `| Sev | File | Pattern | Line | Matches |
|-----|------|---------|------|---------|
${allAlerts.slice(0, 40).map((a) => `| ${a.severity} | \`${a.file}.js\` | ${a.label} | ${a.line} | ${(a.matches || []).join(" · ")} |`).join("\n")}
${allAlerts.length > 40 ? `| … | … | _+${allAlerts.length - 40} more_ | … | … |\n` : ""}
`}
## Naming Convention

All sub-functions follow the format: \`_S_<parent>_<seq>_<hint>\`

| Component | Meaning |
|-----------|---------|
| \`_S_\` | Prefix indicating an extracted sub-function |
| \`<parent>\` | Parent function name, method name, or \`lXXXX\` for anonymous functions |
| \`<seq>\` | Two-digit extraction order within the parent |
| \`<hint>\` | Short hint about the extracted code structure |
| \`_L<line>\` | (Collision only) Source line disambiguator |

### Hint Descriptions

| Hint | Meaning |
|------|---------|
| \`try\` | try block body |
| \`catch\` | catch handler |
| \`if\` | if branch |
| \`else\` | else branch |
| \`case\` | switch case body |
| \`iife_body\` | IIFE body |
| \`init_vars\` | variable initialization |
| \`declare_fn\` | function declarations |
| \`return_val\` | return value expression |
| \`body\` | loop body or block |
| \`block\` | general code block |

---
Generated by deob · ${new Date().toISOString().slice(0, 10)}
`;
}

module.exports = { classifyFileType, writeCrossReadme, generateCrossSummary };

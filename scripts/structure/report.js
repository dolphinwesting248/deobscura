// Report generation: Markdown output and analysis prompts
const { fs, path } = require("../config");
const { OUTPUT_FILES } = require("../constants");
const { analyzeStructure, computeDensity, classifyDomain, generateTLDR } = require("./analyze");

// ── Reading Guide ──────────────────────────────────────────────────

function generateReadingGuide(report) {
  const { functions, hotspots, alerts, tracePath, summary } = report;
  const lines = [];

  // 1. Start here: entry points by importance
  const roots = (hotspots.roots || []).filter((f) => f.calls.length > 0)
    .sort((a, b) => (b.calledBy.length + b.calls.length) - (a.calledBy.length + a.calls.length));
  if (roots.length > 0) {
    lines.push("**Start here:**");
    const top = roots.slice(0, 5);
    for (const r of top) {
      const desc = r.description || "";
      lines.push(`- \`${r.name}\` → ${r.calls.slice(0, 5).join(", ")}${r.calls.length > 5 ? " +" + (r.calls.length - 5) : ""}${desc ? " (" + desc.replace(/[[\]]/g, "") + ")" : ""}`);
    }
    if (roots.length > 5) lines.push(`- _+${roots.length - 5} more entry points_`);
    lines.push("");
  }

  // 2. Top functions by interest score (alerts × complexity × heat)
  const scored = functions.map((f) => {
    const alertCount = alerts.filter((a) => a.fn === f.name).length;
    const heat = f.calledBy.length;
    const score = (alertCount * 3) + (f.complexity || 1) + (Math.min(heat, 20));
    return { ...f, score };
  }).sort((a, b) => b.score - a.score).slice(0, 10).filter((f) => f.score > 2);

  if (scored.length > 0) {
    lines.push("**Most interesting:**");
    for (const f of scored) {
      const why = [];
      if (alerts.some((a) => a.fn === f.name)) why.push("alerts");
      if (f.flat) why.push("flattened");
      if (f.complexity > 5) why.push("cc=" + f.complexity);
      if (f.calledBy.length >= 10) why.push("hot");
      if ((f.suspicious || []).length > 0) why.push("suspicious");
      lines.push(`- \`${f.name}\` (${why.join(", ")})`);
    }
    lines.push("");
  }

  // 3. Alert trace summary
  const alertTraces = report.alertTraces || [];
  if (alertTraces.length > 0) {
    lines.push("**Key traces:**");
    for (const t of alertTraces.slice(0, 5)) {
      lines.push(`- [${t.label}] ${t.path.join(" → ")}`);
    }
    lines.push("");
  }

  // 4. What you can skip
  const skippable = functions.filter((f) => {
    const isMech = /forward|pure computation|pass-through/.test(f.description || "");
    const isData = f.name.includes("_S_return_") && f.bodyLen <= 3;
    const isUtil = !f.flat && f.complexity <= 1 && f.calledBy.length === 0 && f.calls.length === 0;
    return isMech || isData || isUtil;
  });
  if (skippable.length > 5) {
    const types = {};
    for (const f of skippable) {
      const t = f.description || "low-signal";
      types[t] = (types[t] || 0) + 1;
    }
    const summary = Object.entries(types).sort((a, b) => b[1] - a[1]).slice(0, 4)
      .map(([t, c]) => `${c}× ${t.replace(/[[\]]/g, "")}`).join(", ");
    lines.push(`**Skip:** ${skippable.length} low-signal functions (${summary})`);
  }

  return lines.length > 0 ? lines.join("\n") : "_This file has no function-level structure._";
}

function generateMarkdown(report, opts) {
  if (report.error) return `# ${report.file} · Structure Report\n\n> **${report.error}**\n`;
  const brief = opts && opts.brief;
  const fallbackNote = report.fallback ? " *(regex-based fallback)*" : "";
  const { file, summary, hotspots, tracePath, alerts, naming, functions } = report;

  const tldr = report.tldr || generateTLDR(report);
  const domain = report._filepath ? classifyDomain(report._filepath) : "Unknown";
  const density = computeDensity(functions, file);
  let result = `# ${file} · Structure Report${fallbackNote}

> Previous: ${OUTPUT_FILES.PROMPT}  →  **Now: ${OUTPUT_FILES.STRUCTURE}**  →  Next: 2-index.txt → jump to ${OUTPUT_FILES.MAIN}
>
> ${tldr}

## Summary

| Metric | Value |
|--------|-------|
| Domain | ${domain} |
| Total functions | ${summary.totalFunctions} |
| Sub-functions | ${summary.subFunctions} |
| Original functions | ${summary.originalFunctions} |
| Max nesting depth | ${summary.maxDepth} |
| Max complexity | ${summary.maxComplexity || "-"} |
| Flattened (susp.) | ${summary.flattened || 0} |
| Suspicious patterns | ${summary.suspicious || 0} |
| Code density | ${report._density || computeDensity(functions, file)} |

## Hotspots

${tracePath && tracePath.length > 1 ? `**Trace:** \`${tracePath.join("\` → \`")}\`\n\n` : ""}${hotspots.mostCalled.length > 0 ? `| Rank | Type | Details |
|------|------|---------|
${hotspots.mostCalled.map((f, i) => `| ${i + 1} | Most-called | \`${f.name}\` — called by ${f.calledBy.length} functions, calls ${f.calls.length} others |`).join("\n")}
` : ""}${hotspots.roots.length > 0 ? `| — | Roots (${hotspots.roots.length}) | Entry points: ${hotspots.roots.slice(0, 8).map((f) => `\`${f.name}\``).join(", ")}${hotspots.roots.length > 8 ? " …" : ""} |\n` : ""}${hotspots.leaves.length > 0 ? `| — | Leaves (${hotspots.leaves.length}) | Terminal functions: ${hotspots.leaves.slice(0, 8).map((f) => `\`${f.name}\``).join(", ")}${hotspots.leaves.length > 8 ? " …" : ""} |\n` : ""}${hotspots.mostCalled.length === 0 && hotspots.roots.length === 0 && hotspots.leaves.length === 0 ? "_No cross-function calls detected._\n" : ""}
## String Alerts

${alerts.length === 0 ? "_No significant patterns detected._\n" : (() => { const deduped = []; const seen = new Map(); for (const a of alerts) { const key = a.label + "|" + (a.matches||[])[0]; if (seen.has(key)) { const prev = deduped[seen.get(key)]; if (!prev._dupes) prev._dupes = []; prev._dupes.push(a.fn); continue; } seen.set(key, deduped.length); deduped.push({...a}); } return `| Severity | Pattern | Function | Trace | Matches |
|----------|---------|----------|-------|---------|
${deduped.map((a) => {
    const tr = (report.alertTraces || []).find((t) => t.fn === a.fn);
    const afn = functions.find((f) => f.name === a.fn);
    const traceStr = tr ? tr.path.join(" → ") : (afn && afn.calledBy.length === 0) ? "no callers" : "no path";
    const dupes = a._dupes ? " (+ " + a._dupes.length + " dupes)" : "";
    return `| ${a.severity} | ${a.label} | \`${a.fn}\` | ${traceStr} | ${a.matches.join(" · ")}${dupes} |`;
  }).join("\n")}
`})()}
## Hot Groups

${hotspots.hotGroups.filter(([, c]) => c > 0).length === 0 ? "_No significant group activity._\n" : `| Rank | Group | Edges |
|------|-------|-------|
${hotspots.hotGroups.filter(([, c]) => c > 0).map(([g, c], i) => `| ${i + 1} | \`${g}\` | ${c} |`).join("\n")}
`}
${functions.filter((f) => f.calls.length > 0).length > 0 ? `## Call Graph

\`\`\`mermaid
graph TD
${functions.filter((f) => f.calls.length > 0).map((f) =>
    f.calls.map((c) => `  ${f.name} --> ${c}`).join("\n")
  ).join("\n")}
\`\`\`

## Naming Convention` : `_No cross-function call edges to graph._

## Naming Convention`}

All sub-functions follow the format: \`_S_<parent>_<seq>_<hint>\`

| Component | Meaning |
|-----------|---------|
| \`_S_\` | Prefix indicating an extracted sub-function |
| \`<parent>\` | The parent function name, object method name, or line number (\`lXXXX\`) for anonymous functions |
| \`<seq>\` | Two-digit sequence number indicating extraction order within the parent |
| \`<hint>\` | Short hint about the extracted code structure |
| \`_L<line>\` | (Collision only) Source line number appended when name would otherwise collide |

### Examples

| Name | Meaning |
|------|---------|
${naming.examples.map((e) => `| \`${e.name}\` | ${e.meaning} |`).join("\n")}

### Hint Descriptions

| Hint | Meaning |
|------|---------|
${Object.entries(naming.hints).map(([k, v]) => `| \`${k}\` | ${v} |`).join("\n")}

---
Generated by deob · ${new Date().toISOString().slice(0, 10)}
`;
  if (brief) {
    const summaryPath = path.join(path.dirname(report._filepath || ""), OUTPUT_FILES.SUMMARY);
    if (fs.existsSync(summaryPath)) {
      const idx = result.indexOf("\n## Naming Convention\n");
      if (idx > 0) return result.substring(0, idx) + "\n---\n*Naming convention: see summary.md*\n";
    }
  }
  return result;
}

// ── Analysis Prompt ─────────────────────────────────────────────────

function generatePromptFile(outputDir) {
  const mainPath = path.join(outputDir, OUTPUT_FILES.MAIN);
  if (!fs.existsSync(mainPath)) return;
  const report = analyzeStructure(mainPath);
  const { file, summary, functions, hotspots, alerts, tracePath } = report;
  const domain = classifyDomain(mainPath);

  // String decoder detection (prefer string-decoder tag, fall back to self-modifying)
  const decoders = functions.filter((f) => (f.semanticTags || []).includes("string-decoder"))
    .sort((a, b) => b.calledBy.length - a.calledBy.length);
  const selfMod = functions.filter((f) => (f.semanticTags || []).includes("self-modifying") && !(f.semanticTags || []).includes("string-decoder"))
    .sort((a, b) => b.calledBy.length - a.calledBy.length);
  const decoder = decoders.length > 0 ? decoders[0] : (selfMod.length > 0 ? selfMod[0] : null);

  // Entry point
  const roots = (hotspots.roots || []).filter((f) => f.calls.length > 0)
    .sort((a, b) => (b.calledBy.length + b.calls.length) - (a.calledBy.length + a.calls.length));

  // Top 5 by interest score (alerts × 3 + complexity + heat + size bonus)
  // Deprioritize single-letter names (minified artifacts, not meaningful)
  const significantAlerts = alerts.filter(a => a.severity !== "info" && a.severity !== "low");
  const scored = functions
    .filter((f) => f.name.length > 2 || f.calls.length > 0) // skip single-letter leaf functions
    .map((f) => ({
      ...f,
      score: (significantAlerts.filter((a) => a.fn === f.name).length * 3) + (f.complexity || 1) + Math.min(f.calledBy.length, 20) + Math.min(Math.floor((f.bodyLen || 0) / 50), 10) + (f.name.length <= 2 ? -5 : 0)
    })).sort((a, b) => b.score - a.score).slice(0, 5);

  // Pass-through count
  const passThrough = functions.filter((f) => (f.description || "").includes("pass-through")).length;

  const zeroFnWarning = summary.totalFunctions === 0 ? `\n> **WARNING**: 0 functions extracted. This file may be data-only, heavily obfuscated (control-flow flattening / VM-based), or non-JS content. The analysis below is empty — consider manual inspection.\n` : "";

  // Webpack chunk detection
  const domainStr = domain || "";
  const isWebpackChunk = /webpack|rspack|turbopack/i.test(domainStr);
  const chunkWarning = isWebpackChunk ? `\n> **NOTE**: This is a webpack/rspack chunk — it likely contains only a subset of the application logic. Other chunks may contain the actual business logic, API calls, and security-relevant code. Check for additional chunk files.\n` : "";

  // Brief summary: what this file does
  const alertSummary = significantAlerts.length > 0 ? [...new Set(significantAlerts.map(a => a.label))].join(", ") : "";
  const contextLine = domain !== "General JS" ? `${domain}` : "";
  const purposeLine = [contextLine, alertSummary].filter(Boolean).join(" — ");

  const content = `You are analyzing deobfuscated JavaScript from \`${file}\`. The preprocessor already determined:
${zeroFnWarning}${chunkWarning}${purposeLine ? `\n> **Context**: ${purposeLine}\n` : ""}
## Architecture
- ${summary.totalFunctions} functions (${summary.originalFunctions} original, ${summary.subFunctions} extracted)
- Domain: **${domain}**
- ${summary.flattened} flattened, ${summary.suspicious} suspicious patterns, max complexity ${summary.maxComplexity}
- Code density: ${computeDensity(functions, file)}
${decoder ? `- **String decoder**: \`${decoder.name}\` — self-modifying lookup, called by ${decoder.calledBy.length} functions. Strings are NOT yet decoded — you will see opaque calls like \`_0x13f90f(0x1818)\`.` : ""}
${roots.length > 0 ? `- **Entry point**: \`${roots[0].name}\` → ${roots[0].calls.slice(0,5).join(", ")}${roots[0].calls.length > 5 ? " +" + (roots[0].calls.length - 5) : ""}` : ""}

## Alerts (${alerts.filter(a => a.severity !== "info" && a.severity !== "low").length} significant)
${alerts.filter(a => a.severity !== "info" && a.severity !== "low").slice(0, 10).map((a) => {
    const countStr = a.count > 1 ? ` (×${a.count})` : "";
    const fnStr = a.count > 1 && a.fns ? a.fns.slice(0, 3).join(", ") : `\`${a.fn}\``;
    return `- [${a.severity}] **${a.label}**${countStr} in ${fnStr}: ${(a.matches || []).slice(0, 3).join(", ")}`;
  }).join("\n") || "_No significant security alerts detected._"}
${alerts.filter(a => a.severity === "info" || a.severity === "low").length > 0 ? `\n_${alerts.filter(a => a.severity === "info" || a.severity === "low").length} low/info alerts omitted (denoised)._` : ""}

## Start Here (top 5 by interest score)
${scored.map((f, i) => {
    const why = [];
    if (alerts.some((a) => a.fn === f.name)) why.push("alerts");
    if (f.flat) why.push("flattened");
    if ((f.suspicious || []).length > 0) why.push("suspicious");
    if (f.complexity > 5) why.push("cc=" + f.complexity);
    const tags = f.semanticTags || [];
    return `${i + 1}. \`${f.name}\` [${why.join(", ") || "core"}] — ${(f.description || "").replace(/[[\]]/g, "")}${tags.length > 0 ? " [" + tags.join(", ") + "]" : ""}`;
  }).join("\n")}

## Skip
${passThrough} pass-through functions (zero logic). See \`2-index.txt\` for full function catalog.

## Reading Path
1. **This file** (${OUTPUT_FILES.PROMPT}) — architecture, alerts, top 5 functions to start with
2. **${OUTPUT_FILES.STRUCTURE}** — call graph, hotspots, full alert traces, naming convention
3. **2-index.txt** — function catalog with line numbers → jump to \`${OUTPUT_FILES.MAIN}\`
`;
  const outPath = path.join(outputDir, OUTPUT_FILES.PROMPT);
  fs.writeFileSync(outPath, content, "utf-8");
  console.log(`  prompt: ${outPath}`);
}

function runStructure(input, outputDir, opts) {
  const afterPath = path.join(outputDir, OUTPUT_FILES.MAIN);
  if (!fs.existsSync(afterPath)) {
    console.log("  Structure report skipped: no output file found");
    return null;
  }
  const report = analyzeStructure(afterPath, opts);
  report._filepath = afterPath;
  const outPath = path.join(outputDir, OUTPUT_FILES.STRUCTURE);
  const content = generateMarkdown(report, opts);
  fs.writeFileSync(outPath, content, "utf-8");
  console.log(`  1-structure: ${outPath}`);
  return report;
}

module.exports = { generateReadingGuide, generateMarkdown, generatePromptFile, runStructure };

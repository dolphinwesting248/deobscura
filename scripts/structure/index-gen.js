// Compact function index generation
const { fs, path } = require("../config");
const { OUTPUT_FILES, CATEGORY_LABELS } = require("../constants");
const { analyzeStructure, categorizeFn } = require("./analyze");

// ── Compact Index ──────────────────────────────────────────────────

function generateIndex(outputDir, opts) {
  const mainPath = path.join(outputDir, OUTPUT_FILES.MAIN);
  if (!fs.existsSync(mainPath)) {
    console.log("  Index skipped: no output file found");
    return;
  }
  const report = analyzeStructure(mainPath, opts);
  const { summary, functions, alerts, hotspots, lookup, tracePath } = report;

  // ── Analyze function source for size / data / hex annotations
  const code = fs.readFileSync(mainPath, "utf-8");
  const alertLabels = new Map(); // fnName → Set(label)
  for (const a of alerts) {
    if (!alertLabels.has(a.fn)) alertLabels.set(a.fn, new Set());
    alertLabels.get(a.fn).add(a.label);
  }
  const fnMeta = new Map(); // name → { totalLines, stmts, heavyHex, alertLabels, srcText }
  for (const fn of functions) {
    const start = fn.lines[0]; const end = fn.lines[1];
    if (!start || !end) { fnMeta.set(fn.name, { totalLines: 0, stmts: fn.bodyLen, heavyHex: false, alertLabels: alertLabels.get(fn.name), srcText: "" }); continue; }
    const fnLines = code.split("\n").slice(start - 1, end);
    const totalLines = fnLines.length;
    const hexLines = fnLines.filter((l) => l.length > 400 && /0x[0-9a-fA-F]{3,}/.test(l));
    const hugeLines = fnLines.filter((l) => l.length > 2000);
    const heavyHex = (hexLines.length > 0 && hexLines.length / totalLines > 0.2) ||
                     (hugeLines.length > 0 && hugeLines.length / totalLines > 0.1);
    fnMeta.set(fn.name, { totalLines, stmts: fn.bodyLen, heavyHex, alertLabels: alertLabels.get(fn.name), srcText: fnLines.join("\n") });
  }

  const lines = [];
  lines.push(`# ${report.file} · Function Index · ${summary.totalFunctions} functions`);
  lines.push(`_Previous: 1-structure.md  →  **Now: 2-index.txt**  →  Jump to ${OUTPUT_FILES.MAIN} by function name._`);
  lines.push("");
  lines.push("# Legend");
  lines.push("Ss/Pp = S statements, P parameters | cc = cyclomatic complexity (branch density)");
  lines.push("→ = calls | ⇐ = called by | root = entry point (no callers)");
  lines.push("[tags] = semantic tags: alerts, behavior hints, closure captures");
  lines.push("FLAT = control-flow flattened (while+switch) | DATA = heavy hex data");
  lines.push("");

  // Entry points
  const roots = (hotspots.roots || []).filter((f) => f.calls.length > 0);
  if (roots.length > 0) {
    lines.push("## entry");
    for (const f of roots) {
      const flags = [f.flat ? "FLAT" : "", ...(f.suspicious || [])].filter(Boolean).join(" ");
      lines.push(`${f.name} | cc=${f.complexity || 1} | → ${f.calls.join(", ") || "—"}${flags ? " | " + flags : ""}`);
    }
    lines.push("");
  }

  // String alerts
  if (alerts.length > 0) {
    lines.push("## alerts");
    for (const a of alerts) {
      lines.push(`[${a.label}] ${a.fn} · L${a.line} · ${(a.matches || []).join(" ")}`);
    }
    lines.push("");
  }

  // Hot functions
  const mc = (hotspots.mostCalled || []).filter((f) => f.calledBy.length > 0);
  if (mc.length > 0) {
    lines.push("## hot");
    for (const f of mc) {
      lines.push(`${f.name} ⇐ ${f.calledBy.length} callers`);
    }
    lines.push("");
  }

  // Word lookup
  if (lookup.length > 0) {
    lines.push("## lookup");
    for (const [word, fns] of lookup.slice(0, 30)) {
      lines.push(`${word} → ${fns.slice(0, 6).join(", ")}${fns.length > 6 ? " +" + (fns.length - 6) : ""}`);
    }
    lines.push("");
  }

  // Trace paths
  if (tracePath && tracePath.length > 1) {
    lines.push("## trace");
    lines.push(tracePath.join(" → "));
    lines.push("");
  }

  // Suspicious functions
  const suspiciousFns = functions.filter((f) => (f.suspicious || []).length > 0);
  if (suspiciousFns.length > 0) {
    lines.push("## suspicious");
    for (const f of suspiciousFns) {
      lines.push(`${f.name} | ${(f.suspicious || []).join(", ")}`);
    }
    lines.push("");
  }

  // Flattened functions
  const flatFns = functions.filter((f) => f.flat);
  if (flatFns.length > 0) {
    lines.push("## flat");
    for (const f of flatFns) {
      lines.push(`${f.name} | cc=${f.complexity || 1} | while+switch`);
    }
    lines.push("");
  }

  // ── Group functions by category
  const groups = {};
  for (const f of functions) {
    const name = f.name;
    const meta = fnMeta.get(name);
    const cat = categorizeFn(name, f, meta);
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(f);
  }
  const groupLabels = CATEGORY_LABELS;

  // Build parent-name lookup for single-letter function disambiguation
  const parentOf = new Map(); // fnName → parentFnName
  for (const f of functions) {
    for (const c of f.calls) {
      if (!parentOf.has(c)) parentOf.set(c, f.name);
    }
  }

  for (const [cat, fns] of Object.entries(groups)) {
    if (fns.length === 0) continue;
    // Separate return stubs (auto-generated callbacks with 1 caller) from meaningful functions
    const stubs = fns.filter(f => /^_S_return_\d+_fn$/.test(f.name) && f.calledBy.length <= 1 && (f.description || "").includes("callback"));
    const meaningful = fns.filter(f => !stubs.includes(f));

    const label = groupLabels[cat] || cat;
    lines.push(`## fn/${cat}  (${fns.length}) — ${label}`);
    for (const f of meaningful) {
      const meta = fnMeta.get(f.name) || { totalLines: 0, stmts: f.bodyLen, heavyHex: false };
      const size = `${meta.stmts}S/${f.params}P`;
      const callees = f.calls.length > 0 ? " → " + f.calls.join(", ") : "";
      const callers = f.calledBy.length > 0 ? " ⇐ " + f.calledBy.slice(0, 5).join(", ") + (f.calledBy.length > 5 ? " +" + (f.calledBy.length - 5) : "") : callees ? " root" : "";
      const edges = callees + callers;
      const semTags = (f.semanticTags || []).join(" ");
      const desc = f.description || "";
      const flags = [
        meta.heavyHex ? "DATA" : "",
        f.flat ? "FLAT" : "",
        ...(f.suspicious || []),
      ].filter(Boolean).join(" ");
      const roles = f.paramRoles || "";
      // Disambiguate single-letter names with parent context
      const nameDisplay = f.name.length <= 2 && parentOf.has(f.name) ? `${f.name} (←${parentOf.get(f.name)})` : f.name;
      const extras = [roles, semTags, desc, flags].filter(Boolean).join(" ; ");
      lines.push(`${nameDisplay} | ${size} | cc=${f.complexity || 1}${edges ? " |" + edges : ""}${extras ? " | " + extras : ""}`);
    }
    if (stubs.length >= 3) {
      const ccRange = stubs.map(f => f.complexity || 1).sort((a, b) => a - b);
      const ccMin = ccRange[0]; const ccMax = ccRange[ccRange.length - 1];
      lines.push(`... +${stubs.length} auto-generated callbacks (cc=${ccMin}-${ccMax})`);
    } else {
      // Show individually if few
      for (const f of stubs) {
        const meta = fnMeta.get(f.name) || { totalLines: 0, stmts: f.bodyLen, heavyHex: false };
        const size = `${meta.stmts}S/${f.params}P`;
        const calledBy = f.calledBy.length > 0 ? " ⇐ " + f.calledBy.slice(0, 5).join(", ") : "";
        lines.push(`${f.name} | ${size} | cc=${f.complexity || 1}${calledBy} | auto-generated callback`);
      }
    }
    lines.push("");
  }

  const outPath = path.join(outputDir, "2-index.txt");
  fs.writeFileSync(outPath, lines.join("\n"), "utf-8");
  console.log(`  2-index: ${outPath}`);
}

module.exports = { generateIndex };

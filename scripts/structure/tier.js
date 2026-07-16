// Tier filtering: selective function body stripping
const { parser, t, fs, path } = require("../config");
const { analyzeStructure, detectMechanical } = require("./analyze");

// ── Tier Filtering ──────────────────────────────────────────────────

function applyTierFilter(outputDir, tier, fold, denoise) {
  const mainPath = path.join(outputDir, "main.js");
  if (!fs.existsSync(mainPath)) return;

  // Step 1: run full analysis on current main.js
  const report = analyzeStructure(mainPath, { denoise });

  // Step 2: determine keep set (signal functions — always kept in full)
  const keep = new Set();

  if (tier >= 1) {
    for (const fn of report.functions) {
      const hasAlert = (report.alerts || []).some((a) => a.fn === fn.name);
      const isMostCalled = (report.hotspots?.mostCalled || []).some((mc) => mc.name === fn.name);
      const isRoot = (report.hotspots?.roots || []).some((r) => r.name === fn.name);
      const isHot = hasAlert || isMostCalled || isRoot ||
        fn.flat || fn.complexity > 10 || (fn.suspicious || []).length > 0;
      if (isHot) keep.add(fn.name);
    }
  }

  // Tier 2: expand transitively to callees
  if (tier === 2) {
    const expanded = new Set(keep);
    let changed = true;
    while (changed) {
      changed = false;
      for (const fn of report.functions) {
        if (expanded.has(fn.name)) {
          for (const callee of (fn.calls || [])) {
            if (!expanded.has(callee)) {
              expanded.add(callee);
              changed = true;
            }
          }
        }
      }
    }
    for (const name of expanded) keep.add(name);
  }

  if (tier >= 3 || keep.size === 0 || keep.size >= report.functions.length) return;

  // Step 3: parse the generated code
  const code = fs.readFileSync(mainPath, "utf-8");
  let ast;
  try {
    ast = parser.parse(code, {
      sourceType: "script", allowReturnOutsideFunction: true,
      allowUndeclaredExports: true, errorRecovery: true,
    });
  } catch (e) {
    return;
  }

  const fnIdx = new Map();
  for (const f of report.functions) fnIdx.set(f.name, f);

  // Build byte-range edits for non-kept functions
  const edits = [];
  let mechCount = 0;

  for (const stmt of ast.program.body) {
    if (!t.isFunctionDeclaration(stmt) || !stmt.id || keep.has(stmt.id.name)) continue;

    const name = stmt.id.name;
    const fn = fnIdx.get(name);
    const lines = fn && fn.lines[0] ? `L${fn.lines[0]}-${fn.lines[1]}` : "L?";
    const cmp = fn && fn.complexity > 1 ? `, cc=${fn.complexity}` : "";

    if (fold) {
      const mech = detectMechanical(stmt);
      if (mech) {
        mechCount++;
        edits.push({
          start: stmt.start, end: stmt.end,
          replacement: `// [${mech.type}] ${name} · ${lines}${cmp}${mech.detail ? " · " + mech.detail : ""}`,
        });
        continue;
      }
    }

    // Default: keep signature, drop body
    edits.push({
      start: stmt.body.start, end: stmt.body.end,
      replacement: `{ /* ${lines}${cmp} */ }`,
    });
  }

  edits.sort((a, b) => b.start - a.start);

  let filtered = code;
  for (const { start, end, replacement } of edits) {
    filtered = filtered.slice(0, start) + replacement + filtered.slice(end);
  }

  fs.writeFileSync(mainPath, filtered, "utf-8");
  const skipped = edits.length;
  const kept = report.functions.length - skipped;
  const extra = fold && mechCount > 0 ? ` (${mechCount} folded)` : "";
  console.log(`  Tier ${tier}: kept ${kept}/${report.functions.length} functions, ${skipped} signatures${extra}`);
}

module.exports = { applyTierFilter };

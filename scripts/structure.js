// Structure report: Markdown or JSON output of function inventory + call graph
const { parser, t, fs, path } = require("./config");

// ── String alert patterns for reverse-engineering ──────────────────
const ALERT_PATTERNS = [
  { label: "API Endpoint", regex: /https?:\/\/[^\s"'`,;{}[\]]+/gi, severity: "high" },
  { label: "API Path", regex: /\/(?:api|v\d+|rest|graphql|rpc)\/[^\s"'`,;{}[\]]*/gi, severity: "medium" },
  { label: "Token/Key", regex: /\b(?:token|secret|apikey|api_key|accessKey|privateKey|passwd|password|authorization)\b/gi, severity: "high" },
  { label: "Signature", regex: /\b(?:sign|signature|hmac|md5|sha(?:1|256|384|512)|encrypt|decrypt|encodeURIComponent)\b/gi, severity: "high" },
  { label: "Crypto", regex: /\b(?:aes|des|rsa|xor|cipher|createHash|createCipher|createHmac|pbkdf2|randomBytes|createDecipher|subtle)\b/gi, severity: "high" },
  { label: "Eval/Dynamic", regex: /\b(?:eval|Function\s*\(|new\s+Function)\b/gi, severity: "critical" },
  { label: "Storage", regex: /\b(?:localStorage|sessionStorage|indexedDB|setItem|getItem|removeItem|clear\s*\(\))\b/gi, severity: "medium" },
  { label: "DOM Sink", regex: /\b(?:innerHTML|outerHTML|insertAdjacentHTML|document\.write|document\.domain|location\s*=)\b/gi, severity: "medium" },
  { label: "Network", regex: /\b(?:XMLHttpRequest|fetch|axios|WebSocket|EventSource|navigator\.sendBeacon|open\s*\(\s*["'][A-Z]+)\b/gi, severity: "medium" },
  { label: "Config Field", regex: /\b(?:baseURL|baseUrl|timeout|maxRetries|maxSize|maxLength|maxConcurrency|maxConnections)\b/gi, severity: "low" },
];

// ── Quick Lookup Index ──────────────────────────────────────────────

function splitWords(name) {
  // Split on _ and camelCase boundaries, filter noise
  const parts = name.split(/[^a-zA-Z0-9]+/).filter(Boolean);
  const words = [];
  for (const p of parts) {
    // Skip obfuscated hex-like, single char, all digits
    if (/^[0-9a-fA-F]{4,}$/.test(p)) continue;
    if (/^0x/.test(p)) continue;
    if (/^[a-z]_[a-z]/.test(p) && p.length <= 3) continue; // a_b, x_y patterns
    // Split camelCase
    const sub = p.split(/(?=[A-Z])/).filter(Boolean);
    for (const s of sub) {
      const lower = s.toLowerCase();
      if (lower.length < 2) continue;
      if (/^\d+$/.test(lower)) continue;
      words.push(lower);
    }
  }
  // Deduplicate within the same name
  return [...new Set(words)];
}

function buildLookupIndex(fns) {
  const STOP = new Set(["sub", "fn", "ln", "var", "val", "body", "block", "case", "iife", "if", "else"]);
  const index = new Map(); // word → [fn names]

  for (const f of fns) {
    const words = splitWords(f.name);
    // Add description hints from _sub_ patterns
    const descMatch = f.name.match(/_([a-z]+(?:_[a-z]+)*)$/);
    if (descMatch) {
      const desc = descMatch[1].split("_").filter((w) => w.length > 1 && !/^\d+$/.test(w));
      for (const w of desc) words.push(w);
    }
    for (const w of words) {
      if (STOP.has(w)) continue;
      if (/^fn\d+$/.test(w)) continue; // fn1, fn2, ...
      if (/^[a-z]\d+$/i.test(w)) continue; // a0, x1 type obfuscated prefixes
      if (/^[a-z]_[a-z]$/i.test(w)) continue; // a_b patterns
      if (!index.has(w)) index.set(w, []);
      const entry = index.get(w);
      if (!entry.includes(f.name)) entry.push(f.name);
    }
  }

  // Separate semantic words from line-number references
  const semantic = [];
  const locations = [];
  for (const [word, fns] of index) {
    if (/^ln\d+$/.test(word)) {
      if (fns.length >= 2) locations.push([word, fns]); // Only multi-function locations
    } else {
      semantic.push([word, fns]);
    }
  }
  // Sort each group by frequency, take top from each
  semantic.sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  locations.sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));

  return [...semantic.slice(0, 25), ...locations.slice(0, 15)];
}

function analyzeStructureFallback(filepath, code) {
  const file = path.basename(filepath);
  const fnPattern = /\bfunction\s+(\w+)\s*\(([^)]*)\)/g;
  const commentPattern = /\/\/\s*Original lines\s+(\d+)-(\d+)/g;
  const callPattern = /(\w+)\s*\(/g;

  const fns = [];
  const nameMap = new Map();
  let match;

  // Phase 1: collect all functions via regex
  while ((match = fnPattern.exec(code)) !== null) {
    const name = match[1];
    const params = match[2] ? match[2].split(",").filter((s) => s.trim()).length : 0;
    const pos = code.lastIndexOf("\n", match.index) + 1;
    const startLine = code.substring(0, pos).split("\n").length;
    fns.push({ name, lines: [startLine, startLine], params, bodyLen: 0, calls: [], calledBy: [], comment: "" });
    nameMap.set(name, fns.length - 1);
  }

  // Phase 2: extract Original lines comments
  let ci = 0;
  while ((match = commentPattern.exec(code)) !== null) {
    if (ci < fns.length) {
      // Find the function after this comment
      const afterComment = code.indexOf("function", match.index);
      for (let i = ci; i < fns.length; i++) {
        const fnIdx = code.lastIndexOf("function " + fns[i].name, afterComment);
        if (fnIdx > match.index - 200 && fnIdx < afterComment + 200) {
          fns[i].lines = [parseInt(match[1]), parseInt(match[2])];
          fns[i].comment = "Original lines " + match[1] + "-" + match[2];
          ci = i + 1;
          break;
        }
      }
    }
  }

  // Phase 3: collect call edges (simple: match known names as callees)
  const knownNames = new Set(fns.map((f) => f.name));
  for (const f of fns) {
    const fnStart = code.indexOf("function " + f.name + "(");
    if (fnStart < 0) continue;
    // Find the function body
    let depth = 0, bodyStart = -1, bodyEnd = -1;
    for (let i = fnStart; i < code.length; i++) {
      if (code[i] === "{") { depth++; if (bodyStart < 0) bodyStart = i; }
      else if (code[i] === "}") { depth--; if (depth === 0) { bodyEnd = i; break; } }
    }
    if (bodyStart < 0 || bodyEnd < 0) continue;
    const body = code.substring(bodyStart + 1, bodyEnd);
    for (const target of knownNames) {
      if (target === f.name) continue;
      if (new RegExp("\\b" + target + "\\s*\\(").test(body)) {
        f.calls.push(target);
        const tgt = fns[nameMap.get(target)];
        if (tgt) tgt.calledBy.push(f.name);
      }
    }
  }

  // Phase 4: summary
  const subFns = fns.filter((f) => f.name.startsWith("_sub_"));
  const origins = fns.filter((f) => !f.name.startsWith("_sub_"));
  const types = {};
  for (const f of subFns) {
    const n = f.name;
    if (n.match(/_try$/)) types.tryCatch = (types.tryCatch || 0) + 1;
    else if (n.match(/_if$/) || n.match(/_else$/)) types.ifElse = (types.ifElse || 0) + 1;
    else if (n.includes("_iife") || n.includes("_init_")) types.iife = (types.iife || 0) + 1;
    else if (n.includes("_case")) types.switch = (types.switch || 0) + 1;
    else if (n.startsWith("_sub_return_fn")) types.inlineFn = (types.inlineFn || 0) + 1;
    else if (n.startsWith("_sub_program")) types.program = (types.program || 0) + 1;
    else types.other = (types.other || 0) + 1;
  }

  // Phase 5: regex-based string alerts for fallback
  const alerts = [];
  for (const f of fns) {
    const fnStart = code.indexOf("function " + f.name + "(");
    if (fnStart < 0) continue;
    let depth = 0, bs = -1, be = -1;
    for (let i = fnStart; i < code.length; i++) {
      if (code[i] === "{") { depth++; if (bs < 0) bs = i; }
      else if (code[i] === "}") { depth--; if (depth === 0) { be = i; break; } }
    }
    if (bs < 0 || be < 0) continue;
    const body = code.substring(bs + 1, be);
    for (const p of ALERT_PATTERNS) {
      const matches = [];
      let m;
      p.regex.lastIndex = 0;
      while ((m = p.regex.exec(body)) !== null) matches.push(m[0]);
      p.regex.lastIndex = 0;
      if (matches.length > 0) {
        alerts.push({ fn: f.name, line: f.lines[0], label: p.label, severity: p.severity, matches: [...new Set(matches)] });
      }
    }
  }

  // Phase 6: hotspots (same as AST path)
  const byIncoming = [...fns].sort((a, b) => b.calledBy.length - a.calledBy.length);
  const mostCalled = byIncoming.slice(0, 10).filter((f) => f.calledBy.length > 0);
  const roots = fns.filter((f) => f.calledBy.length === 0 && f.calls.length > 0);
  const leaves = fns.filter((f) => f.calls.length === 0 && f.calledBy.length > 0);
  const groupEdges = {};
  for (const f of fns) {
    const m = f.name.match(/^_sub_(.+?)_\d{2}_/);
    const grp = m ? m[1] : "top-level";
    groupEdges[grp] = (groupEdges[grp] || 0) + f.calls.length + f.calledBy.length;
  }
  const hotGroups = Object.entries(groupEdges).sort((a, b) => b[1] - a[1]).slice(0, 10);

  const lookup = buildLookupIndex(fns);

  return {
    file,
    error: null,
    fallback: true,
    lookup,
    summary: {
      totalFunctions: fns.length,
      subFunctions: subFns.length,
      originalFunctions: origins.length,
      byType: types,
      maxDepth: Math.max(...subFns.map((f) => (f.name.match(/_/g) || []).length), 0),
    },
    hotspots: { mostCalled, roots, leaves, hotGroups },
    alerts,
    naming: {
      format: "_sub_<parent>_<seq>_<description>",
      examples: [
        { name: "_sub_0x28bed7_01_try", meaning: "Extracted from function 0x28bed7, sequence 01, try body" },
        { name: "_sub_constructor_07_if", meaning: "Extracted from method 'constructor', sequence 07, if branch" },
      ],
      hints: { try: "try block body", catch: "catch handler", if: "if branch", else: "else branch" },
    },
    functions: fns,
  };
}

function analyzeStructure(filepath) {
  const code = fs.readFileSync(filepath, "utf-8");
  let ast;
  try {
    ast = parser.parse(code, {
      sourceType: "script", allowReturnOutsideFunction: true,
      allowUndeclaredExports: true, errorRecovery: true,
    });
  } catch (e) {
    // Fallback: regex-based analysis for files that Babel can't re-parse
    // (sloppy-mode reserved words as identifiers, for-await outside async, etc.)
    return analyzeStructureFallback(filepath, code);
  }

  const fns = []; // {name, lines, params, calls:[], calledBy:[], comment}
  const nameMap = new Map();

  // Phase 1: collect all _sub_ function declarations
  for (const stmt of ast.program.body) {
    if (t.isFunctionDeclaration(stmt) && stmt.id) {
      const name = stmt.id.name;
      const lines = stmt.loc ? [stmt.loc.start.line, stmt.loc.end.line] : [0, 0];
      const params = stmt.params.length;
      const bl = t.isBlockStatement(stmt.body) ? stmt.body.body.length : 1;
      const comment = (stmt.leadingComments && stmt.leadingComments.length > 0)
        ? stmt.leadingComments[0].value.trim() : "";
      fns.push({ name, lines, params, bodyLen: bl, calls: [], calledBy: [], comment });
      nameMap.set(name, fns.length - 1);
    }
  }

  // Phase 2: collect call edges
  function walk(node, callerName) {
    if (!node || typeof node !== "object") return;
    if (t.isCallExpression(node) && t.isIdentifier(node.callee) && nameMap.has(node.callee.name)) {
      const calleeIdx = nameMap.get(node.callee.name);
      const callerIdx = nameMap.get(callerName);
      if (callerIdx !== undefined && !fns[callerIdx].calls.includes(node.callee.name)) {
        fns[callerIdx].calls.push(node.callee.name);
      }
      fns[calleeIdx].calledBy.push(callerName);
    }
    for (const k of Object.keys(node)) {
      if (k === "start" || k === "end" || k === "loc" ||
          k.startsWith("lead") || k.startsWith("trail") || k.startsWith("inner")) continue;
      const v = node[k];
      if (Array.isArray(v)) { for (const x of v) walk(x, callerName); }
      else if (v && typeof v.type === "string") walk(v, callerName);
    }
  }
  for (const stmt of ast.program.body) {
    if (t.isFunctionDeclaration(stmt) && stmt.id) walk(stmt.body, stmt.id.name);
  }

  // Phase 3: summary
  const subFns = fns.filter((f) => f.name.startsWith("_sub_"));
  const origins = fns.filter((f) => !f.name.startsWith("_sub_"));
  const types = {};
  for (const f of subFns) {
    const n = f.name;
    if (n.match(/_try$/)) types.tryCatch = (types.tryCatch || 0) + 1;
    else if (n.match(/_if$/) || n.match(/_else$/)) types.ifElse = (types.ifElse || 0) + 1;
    else if (n.includes("_iife") || n.includes("_init_")) types.iife = (types.iife || 0) + 1;
    else if (n.includes("_case")) types.switch = (types.switch || 0) + 1;
    else if (n.startsWith("_sub_return_fn")) types.inlineFn = (types.inlineFn || 0) + 1;
    else if (n.startsWith("_sub_program")) types.program = (types.program || 0) + 1;
    else types.other = (types.other || 0) + 1;
  }

  // Phase 4: string alerts — scan function bodies for key patterns
  const alerts = [];
  for (const stmt of ast.program.body) {
    if (!t.isFunctionDeclaration(stmt) || !stmt.id) continue;
    const fnName = stmt.id.name;
    function collectStrings(node) {
      if (!node || typeof node !== "object") return;
      if (t.isStringLiteral(node) && node.value) {
        for (const p of ALERT_PATTERNS) {
          const matches = [];
          let m;
          p.regex.lastIndex = 0;
          while ((m = p.regex.exec(node.value)) !== null) {
            matches.push(m[0]);
          }
          p.regex.lastIndex = 0;
          if (matches.length > 0) {
            alerts.push({
              fn: fnName,
              line: node.loc ? node.loc.start.line : 0,
              label: p.label,
              severity: p.severity,
              matches: [...new Set(matches)],
            });
          }
        }
      }
      // Don't recurse into nested functions (each is its own analysis unit)
      if (t.isFunction(node)) return;
      for (const k of Object.keys(node)) {
        if (k === "start" || k === "end" || k === "loc" ||
            k.startsWith("lead") || k.startsWith("trail") || k.startsWith("inner")) continue;
        const v = node[k];
        if (Array.isArray(v)) { for (const x of v) collectStrings(x); }
        else if (v && typeof v.type === "string") collectStrings(v);
      }
    }
    collectStrings(stmt);
  }

  // Phase 5: hotspots — function heat rankings
  const byIncoming = [...fns].sort((a, b) => b.calledBy.length - a.calledBy.length);
  const mostCalled = byIncoming.slice(0, 10).filter((f) => f.calledBy.length > 0);
  const roots = fns.filter((f) => f.calledBy.length === 0 && f.calls.length > 0);
  const leaves = fns.filter((f) => f.calls.length === 0 && f.calledBy.length > 0);
  // Hot groups: count edges per parent group
  const groupEdges = {};
  for (const f of fns) {
    const m = f.name.match(/^_sub_(.+?)_\d{2}_/);
    const grp = m ? m[1] : "top-level";
    groupEdges[grp] = (groupEdges[grp] || 0) + f.calls.length + f.calledBy.length;
  }
  const hotGroups = Object.entries(groupEdges)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  const lookup = buildLookupIndex(fns);

  return {
    file: path.basename(filepath),
    lookup,
    summary: {
      totalFunctions: fns.length,
      subFunctions: subFns.length,
      originalFunctions: origins.length,
      byType: types,
      maxDepth: Math.max(...subFns.map((f) => (f.name.match(/_/g) || []).length), 0),
    },
    hotspots: { mostCalled, roots, leaves, hotGroups },
    alerts,
    naming: {
      format: "_sub_<parent>_<seq>_<description>",
      examples: [
        { name: "_sub_0x28bed7_01_try", meaning: "Extracted from function 0x28bed7, sequence 01, try body" },
        { name: "_sub_constructor_07_if", meaning: "Extracted from method 'constructor', sequence 07, if branch" },
        { name: "_sub_ln100877_07_else", meaning: "Extracted from anonymous function at line 100877, sequence 07, else branch" },
        { name: "_sub_program_init_vars_ln1149", meaning: "Top-level program IIFE at line 1149, variable initialization" },
        { name: "_sub_return_fn1", meaning: "Inline function expression lifted from a return statement" },
      ],
      hints: {
        try: "try block body",
        catch: "catch handler",
        if: "if branch",
        else: "else branch",
        case: "switch case body",
        iife_body: "IIFE body",
        init_vars: "variable initialization",
        declare_fn: "function declarations",
        return_val: "return value expression",
        body: "loop body or block",
        block: "general code block",
      },
    },
    functions: fns,
  };
}

function generateMarkdown(report) {
  if (report.error) return `# Structure Report · ${report.file}\n\n> **${report.error}**\n`;
  const fallbackNote = report.fallback ? " *(regex-based fallback)*" : "";
  const { file, summary, lookup, hotspots, alerts, naming, functions } = report;
  const typeTable = Object.entries(summary.byType).map(([k, v]) => `| ${k} | ${v} |`).join("\n");

  return `# Structure Report · ${file}${fallbackNote}

## Summary

| Metric | Value |
|--------|-------|
| Total functions | ${summary.totalFunctions} |
| Sub-functions | ${summary.subFunctions} |
| Original functions | ${summary.originalFunctions} |
| Max nesting depth | ${summary.maxDepth} |

### By Extraction Type

| Type | Count |
|------|-------|
${typeTable}

### Hotspots

${hotspots.mostCalled.length > 0 ? `| Rank | Type | Details |
|------|------|---------|
${hotspots.mostCalled.map((f, i) => `| ${i + 1} | Most-called | \`${f.name}\` — called by ${f.calledBy.length} functions, calls ${f.calls.length} others |`).join("\n")}
` : ""}${hotspots.roots.length > 0 ? `| — | Roots (${hotspots.roots.length}) | Entry points: ${hotspots.roots.slice(0, 8).map((f) => `\`${f.name}\``).join(", ")}${hotspots.roots.length > 8 ? " …" : ""} |\n` : ""}${hotspots.leaves.length > 0 ? `| — | Leaves (${hotspots.leaves.length}) | Terminal functions: ${hotspots.leaves.slice(0, 8).map((f) => `\`${f.name}\``).join(", ")}${hotspots.leaves.length > 8 ? " …" : ""} |\n` : ""}${hotspots.mostCalled.length === 0 && hotspots.roots.length === 0 && hotspots.leaves.length === 0 ? "_No cross-function calls detected._\n" : ""}
### Hot Groups

${hotspots.hotGroups.filter(([, c]) => c > 0).length === 0 ? "_No significant group activity._\n" : `| Rank | Group | Edges |
|------|-------|-------|
${hotspots.hotGroups.filter(([, c]) => c > 0).map(([g, c], i) => `| ${i + 1} | \`${g}\` | ${c} |`).join("\n")}
`}

### Quick Lookup

| Word | Functions |
|------|-----------|
${lookup.map(([word, fns]) => `| \`${word}\` | ${fns.slice(0, 6).map((f) => `\`${f}\``).join(" · ")}${fns.length > 6 ? ` _+${fns.length - 6} more_` : ""} |`).join("\n")}

### String Alerts

${alerts.length === 0 ? "_No significant patterns detected._\n" : `| Severity | Pattern | Function | Line | Matches |
|----------|---------|----------|------|---------|
${alerts.map((a) => `| ${a.severity} | ${a.label} | \`${a.fn}\` | ${a.line} | ${a.matches.join(" · ")} |`).join("\n")}
`}
## Naming Convention

All sub-functions follow the format: \`_sub_<parent>_<seq>_<description>\`

| Component | Meaning |
|-----------|---------|
| \`_sub_\` | Prefix indicating an extracted sub-function |
| \`<parent>\` | The parent function name, object method name, or line number (\`lnXXXX\`) for anonymous functions |
| \`<seq>\` | Two-digit sequence number indicating extraction order within the parent |
| \`<description>\` | Short hint about the extracted code structure |

### Examples

| Name | Meaning |
|------|---------|
${naming.examples.map((e) => `| \`${e.name}\` | ${e.meaning} |`).join("\n")}

### Hint Descriptions

| Hint | Meaning |
|------|---------|
${Object.entries(naming.hints).map(([k, v]) => `| \`${k}\` | ${v} |`).join("\n")}

## Call Graph

\`\`\`mermaid
graph TD
${functions.filter((f) => f.calls.length > 0).map((f) =>
    f.calls.map((c) => `  ${f.name} --> ${c}`).join("\n")
  ).join("\n")}
\`\`\`

## Function Inventory

| # | Name | Lines | Params | Calls | Called By |
|---|------|-------|--------|-------|-----------|
${functions.map((f, i) => {
    const lines = f.lines[0] ? `${f.lines[0]}-${f.lines[1]}` : "-";
    const calls = f.calls.length > 0 ? f.calls.join(", ") : "—";
    const calledBy = f.calledBy.length > 0 ? f.calledBy.join(", ") : "root";
    return `| ${i + 1} | \`${f.name}\` | ${lines} | ${f.params} | ${calls} | ${calledBy} |`;
  }).join("\n")}

---
Generated by deob · ${new Date().toISOString().slice(0, 10)}
`;
}

function generateJSON(report) {
  return JSON.stringify(report, null, 2);
}

function runStructure(input, outputDir, format) {
  const afterPath = path.join(outputDir, "main.js");
  if (!fs.existsSync(afterPath)) {
    console.log("  Structure report skipped: no output file found");
    return null;
  }
  const report = analyzeStructure(afterPath);
  const ext = format === "md" ? ".md" : ".json";
  const outPath = path.join(outputDir, "structure" + ext);
  const content = format === "md" ? generateMarkdown(report) : generateJSON(report);
  fs.writeFileSync(outPath, content, "utf-8");
  console.log(`  Structure report: ${outPath}`);
  return report;
}

// ── Cross-File Summary ──────────────────────────────────────────────

function generateCrossSummary(results, dirName, format) {
  const files = results.map((r) => ({
    name: r.file,
    total: r.report.summary.totalFunctions,
    sub: r.report.summary.subFunctions,
    orig: r.report.summary.originalFunctions,
    alerts: (r.report.alerts || []).length,
  }));

  // Merge hotspots: find most-called across all files
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

  // Merge lookup index
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
  const topLookup = [...globalLookup.entries()]
    .filter(([, fns]) => fns.length >= 2 && fns.length <= 80)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 20);

  if (format === "json") {
    return JSON.stringify({ dir: dirName, files, topLookup, mostCalled: allMostCalled.slice(0, 15), roots: allRoots, alerts: allAlerts }, null, 2);
  }

  // Markdown
  return `# Cross-File Summary · ${dirName}

## Files (${files.length})

| # | File | Functions | Sub-fns | Originals | Alerts |
|---|------|-----------|---------|-----------|--------|
${files.map((f, i) => `| ${i + 1} | \`${f.name}.js\` | ${f.total} | ${f.sub} | ${f.orig} | ${f.alerts} |`).join("\n")}

## Cross-File Hotspots

${allMostCalled.length > 0 ? `| Rank | File | Function | Called By |
|------|------|----------|-----------|
${allMostCalled.slice(0, 15).map((m, i) => `| ${i + 1} | \`${m.file}.js\` | \`${m.name}\` | ${m.callers} |`).join("\n")}
` : "_No cross-file call data available._\n"}
${allRoots.length > 0 ? `### Root Functions (${allRoots.length})
${allRoots.slice(0, 15).map((r) => `- \`${r.file}.js\` → \`${r.name}\``).join("\n")}
${allRoots.length > 15 ? `- _+${allRoots.length - 15} more_\n` : ""}
` : ""}
## Cross-File Lookup

| Word | Files & Functions |
|------|-------------------|
${topLookup.map(([word, fns]) => `| \`${word}\` | ${fns.slice(0, 5).map((f) => `\`${f}\``).join(" · ")}${fns.length > 5 ? ` _+${fns.length - 5} more_` : ""} |`).join("\n")}

## Cross-File Alerts

${allAlerts.length === 0 ? "_No alerts across files._\n" : `| Sev | File | Pattern | Line | Matches |
|-----|------|---------|------|---------|
${allAlerts.slice(0, 40).map((a) => `| ${a.severity} | \`${a.file}.js\` | ${a.label} | ${a.line} | ${(a.matches || []).join(" · ")} |`).join("\n")}
${allAlerts.length > 40 ? `| … | … | _+${allAlerts.length - 40} more_ | … | … |\n` : ""}
`}
---
Generated by deob · ${new Date().toISOString().slice(0, 10)}
`;
}

module.exports = { analyzeStructure, generateMarkdown, generateJSON, generateCrossSummary, runStructure };

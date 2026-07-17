// Core analysis functions for structure report
const { parser, t, fs, path } = require("../config");
const { ALERT_PATTERNS } = require("../constants");
const { DEFAULT_PARSER_OPTS, JSX_PARSER_OPTS, SUB_FN_PREFIX, SUB_FN_NAME_RE, isSubFn, SKIP_KEYS, THRESHOLDS, CATEGORIES, SEVERITY, NAMING_FORMAT, NAMING_COLLISION, NAMING_EXAMPLES, NAMING_HINTS, DOMAIN_RULES, CATEGORY_RULES, FRAMEWORK_PATTERNS } = require("../constants");

// Simple cache: avoid re-parsing the same file in a single run
const _analysisCache = new Map();
function cachedAnalyze(filepath, opts) {
  const key = filepath + JSON.stringify(opts && opts.denoise || null);
  if (_analysisCache.has(key)) return _analysisCache.get(key);
  const result = analyzeStructureImpl(filepath, opts);
  _analysisCache.set(key, result);
  return result;
}
function clearAnalysisCache() { _analysisCache.clear(); }

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
  const STOP = new Set(["sub", "fn", "ln", "var", "val", "body", "block", "case", "iife", "if", "else", "return", "undefined", "null"]);
  const index = new Map(); // word → [fn names]

  for (const f of fns) {
    const words = splitWords(f.name);
    // Add description hints from _S_ patterns
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
  const subFns = fns.filter((f) => f.name.startsWith(SUB_FN_PREFIX));
  const origins = fns.filter((f) => !f.name.startsWith(SUB_FN_PREFIX));
  const types = {};
  for (const f of subFns) {
    const n = f.name;
    if (n.match(/_try$/)) types.tryCatch = (types.tryCatch || 0) + 1;
    else if (n.match(/_if$/) || n.match(/_else$/)) types.ifElse = (types.ifElse || 0) + 1;
    else if (n.includes("_iife") || n.includes("_init_")) types.iife = (types.iife || 0) + 1;
    else if (n.includes("_case")) types.switch = (types.switch || 0) + 1;
    else if (n.startsWith(SUB_FN_PREFIX + "return_")) types.inlineFn = (types.inlineFn || 0) + 1;
    else if (n.startsWith("_S_program")) types.program = (types.program || 0) + 1;
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

  // Phase 6: hotspots — rank by callers × complexity (not just caller count)
  const byIncoming = [...fns].sort((a, b) => {
    const scoreA = a.calledBy.length * (a.complexity || 1);
    const scoreB = b.calledBy.length * (b.complexity || 1);
    return scoreB - scoreA;
  });
  const mostCalled = byIncoming.slice(0, 10).filter((f) => f.calledBy.length > 0);
  const roots = fns.filter((f) => f.calledBy.length === 0 && f.calls.length > 0);
  const leaves = fns.filter((f) => f.calls.length === 0 && f.calledBy.length > 0);
  const groupEdges = {};
  for (const f of fns) {
    const m = f.name.match(SUB_FN_NAME_RE);
    const grp = m ? m[1] : "top-level";
    groupEdges[grp] = (groupEdges[grp] || 0) + f.calls.length + f.calledBy.length;
  }
  const hotGroups = Object.entries(groupEdges).sort((a, b) => b[1] - a[1]).slice(0, 10);

  const lookup = buildLookupIndex(fns);

  const report = {
    file,
    error: null,
    fallback: true,
    summary: {
      totalFunctions: fns.length,
      subFunctions: subFns.length,
      originalFunctions: origins.length,
      byType: types,
      maxDepth: Math.max(...subFns.map((f) => (f.name.match(/_/g) || []).length), 0),
    },
    hotspots: { mostCalled, roots, leaves, hotGroups },
    alerts,
    lookup,
    naming: {
      format: "_S_<parent>_<seq>_<hint>",
      collision: "_S_<parent>_L<line>_<seq>_<hint> (when name collides)",
      examples: [
        { name: "_S_0x28bed7_01_try", meaning: "Extracted from function 0x28bed7, seq 01, try body" },
        { name: "_S_constructor_07_if", meaning: "Extracted from method 'constructor', seq 07, if branch" },
        { name: "_S_l100877_03_try", meaning: "Anonymous parent at line 100877, seq 03, try body" },
        { name: "_S_return_1_fn", meaning: "Inline function lifted from a return statement" },
        { name: "_S_l251_L1364_01_try vs _S_l251_L1548_01_try", meaning: "Two try blocks with same parent+seq+hint — _L<line> disambiguates by source line" },
      ],
      hints: { try: "try block body", catch: "catch handler", if: "if branch", else: "else branch", fn: "inline function" },
    },
    functions: fns,
  };
  report.tldr = generateTLDR(report);
  return report;
}

function analyzeStructureImpl(filepath, opts) {
  const denoise = opts && opts.denoise;
  const code = fs.readFileSync(filepath, "utf-8");
  let ast;
  try {
    ast = parser.parse(code, DEFAULT_PARSER_OPTS);
  } catch (e) {
    try {
      ast = parser.parse(code, JSX_PARSER_OPTS);
    } catch (e2) {
      return analyzeStructureFallback(filepath, code);
    }
  }

  const fns = []; // {name, lines, params, calls:[], calledBy:[], comment, complexity, flat, suspicious}
  const nameMap = new Map();
  let flattenedCount = 0;
  let suspiciousCount = 0;

  // Phase 1: collect all function declarations + compute complexity & patterns
  for (const stmt of ast.program.body) {
    if (t.isFunctionDeclaration(stmt) && stmt.id) {
      const name = stmt.id.name;
      const lines = stmt.loc ? [stmt.loc.start.line, stmt.loc.end.line] : [0, 0];
      const params = stmt.params.length;
      const bl = t.isBlockStatement(stmt.body) ? stmt.body.body.length : 1;
      const comment = (stmt.leadingComments && stmt.leadingComments.length > 0)
        ? stmt.leadingComments[0].value.trim() : "";

      // ── A: flattening detection ──
      let hasFlattening = false;
      function detectFlat(n) {
        if (!n || typeof n !== "object") return;
        if ((t.isWhileStatement(n) || t.isForStatement(n)) && containsSwitch(n.body)) { hasFlattening = true; }
        if (t.isFunction(n)) return;
        for (const k of Object.keys(n)) {
          if (SKIP_KEYS.has(k)) continue;
          const v = n[k];
          if (Array.isArray(v)) { for (const x of v) detectFlat(x); }
          else if (v && typeof v.type === "string") detectFlat(v);
        }
      }
      function containsSwitch(n) {
        if (!n || typeof n !== "object") return false;
        if (t.isSwitchStatement(n)) return true;
        if (t.isFunction(n)) return false;
        for (const k of Object.keys(n)) {
          if (SKIP_KEYS.has(k)) continue;
          const v = n[k];
          if (Array.isArray(v)) { for (const x of v) { if (containsSwitch(x)) return true; } }
          else if (v && typeof v.type === "string") { if (containsSwitch(v)) return true; }
        }
        return false;
      }
      detectFlat(stmt.body);
      // Detect array/object jump-table dispatchers
      if (!hasFlattening && detectJumpTable(stmt.body)) hasFlattening = true;
      if (hasFlattening) flattenedCount++;

      // ── B: cyclomatic complexity ──
      let complexity = 1;
      function calcComplexity(n) {
        if (!n || typeof n !== "object") return;
        if (t.isIfStatement(n)) complexity++;
        if (t.isForStatement(n) || t.isWhileStatement(n) || t.isDoWhileStatement(n)) complexity++;
        if (t.isSwitchCase(n)) complexity++;
        if (t.isConditionalExpression(n)) complexity++;
        if (t.isLogicalExpression(n) && (n.operator === "&&" || n.operator === "||")) complexity++;
        if (t.isCatchClause(n)) complexity++;
        if (t.isFunction(n)) return;
        for (const k of Object.keys(n)) {
          if (SKIP_KEYS.has(k)) continue;
          const v = n[k];
          if (Array.isArray(v)) { for (const x of v) calcComplexity(x); }
          else if (v && typeof v.type === "string") calcComplexity(v);
        }
      }
      calcComplexity(stmt.body);

      // ── C: suspicious structural patterns ──
      const suspicious = [];
      function detectSuspicious(n) {
        if (!n || typeof n !== "object") return;
        // eval(identifier) — non-literal eval
        if (t.isCallExpression(n) && t.isIdentifier(n.callee) && n.callee.name === "eval" &&
            n.arguments.length > 0 && !t.isStringLiteral(n.arguments[0])) {
          suspicious.push("eval(var)");
        }
        // new Function(...)
        if ((t.isNewExpression(n) || t.isCallExpression(n)) &&
            t.isIdentifier(n.callee) && n.callee.name === "Function" &&
            n.arguments.length > 0) {
          suspicious.push("new Function()");
        }
        // obj[computed_key] — only flag suspicious key patterns, not all bracket access
        if (t.isMemberExpression(n) && n.computed && t.isStringLiteral(n.property) &&
            /__(?:proto|proto__|defineProperty|lookupGetter|lookupSetter)__/.test(n.property.value)) {
          suspicious.push("dangerous key: " + n.property.value);
        }
        // arguments[i] — removed: varargs iteration is normal, not suspicious
        // __proto__ assignment
        if (t.isAssignmentExpression(n) && t.isMemberExpression(n.left) &&
            t.isIdentifier(n.left.property, { name: "__proto__" })) {
          suspicious.push("__proto__");
        }
        if (t.isFunction(n)) return;
        for (const k of Object.keys(n)) {
          if (SKIP_KEYS.has(k)) continue;
          const v = n[k];
          if (Array.isArray(v)) { for (const x of v) detectSuspicious(x); }
          else if (v && typeof v.type === "string") detectSuspicious(v);
        }
      }
      detectSuspicious(stmt.body);
      if (suspicious.length > 0) suspiciousCount++;

      fns.push({ name, lines, params, bodyLen: bl, calls: [], calledBy: [], comment,
        complexity, flat: hasFlattening, suspicious: [...new Set(suspicious)],
        semanticTags: detectSemanticTags(name, stmt), description: describeFn(stmt),
        paramRoles: detectParamRoles(stmt) });
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
      if (!fns[calleeIdx].calledBy.includes(callerName)) {
        fns[calleeIdx].calledBy.push(callerName);
      }
    }
    for (const k of Object.keys(node)) {
      if (SKIP_KEYS.has(k)) continue;
      const v = node[k];
      if (Array.isArray(v)) { for (const x of v) walk(x, callerName); }
      else if (v && typeof v.type === "string") walk(v, callerName);
    }
  }
  for (const stmt of ast.program.body) {
    if (t.isFunctionDeclaration(stmt) && stmt.id) walk(stmt.body, stmt.id.name);
  }

  // Phase 3: summary
  const subFns = fns.filter((f) => f.name.startsWith(SUB_FN_PREFIX));
  const origins = fns.filter((f) => !f.name.startsWith(SUB_FN_PREFIX));
  const types = {};
  for (const f of subFns) {
    const n = f.name;
    if (n.match(/_try$/)) types.tryCatch = (types.tryCatch || 0) + 1;
    else if (n.match(/_if$/) || n.match(/_else$/)) types.ifElse = (types.ifElse || 0) + 1;
    else if (n.includes("_iife") || n.includes("_init_")) types.iife = (types.iife || 0) + 1;
    else if (n.includes("_case")) types.switch = (types.switch || 0) + 1;
    else if (n.startsWith(SUB_FN_PREFIX + "return_")) types.inlineFn = (types.inlineFn || 0) + 1;
    else if (n.startsWith("_S_program")) types.program = (types.program || 0) + 1;
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
      // AST-based alert detection
      if (node.type === "DebuggerStatement") {
        alerts.push({ fn: fnName, line: node.loc ? node.loc.start.line : 0, label: "Anti-Tamper", severity: "high", matches: ["debugger"] });
      }
      if (t.isCallExpression(node) || t.isNewExpression(node)) {
        if (t.isIdentifier(node.callee, { name: "eval" })) {
          alerts.push({ fn: fnName, line: node.loc ? node.loc.start.line : 0, label: "Eval/Dynamic", severity: "critical", matches: ["eval()"] });
        }
        if (t.isIdentifier(node.callee, { name: "Function" })) {
          alerts.push({ fn: fnName, line: node.loc ? node.loc.start.line : 0, label: "Eval/Dynamic", severity: "critical", matches: ["new Function()"] });
        }
      }
      for (const k of Object.keys(node)) {
        if (SKIP_KEYS.has(k)) continue;
        const v = node[k];
        if (Array.isArray(v)) { for (const x of v) collectStrings(x); }
        else if (v && typeof v.type === "string") collectStrings(v);
      }
    }
    collectStrings(stmt.body);
  }

  // Phase 4b: denoise alerts using configurable rules
  if (denoise && denoise.length > 0) {
    for (const a of alerts) {
      if (!a.matches) continue;
      const text = a.matches.join(" ");
      for (const rule of denoise) {
        try {
          if (new RegExp(rule.match, "i").test(text)) {
            a.label = rule.label;
            if (rule.severity) a.severity = rule.severity;
            break;
          }
        } catch (e) { /* skip invalid regex */ }
      }
    }
  }

  // Phase 4c: deduplicate alerts — merge same label+match into one with count
  const dedupedAlerts = [];
  const alertSeen = new Map(); // key → index in dedupedAlerts
  for (const a of alerts) {
    const key = a.label + "|" + (a.matches || []).sort().join(",");
    if (alertSeen.has(key)) {
      const existing = dedupedAlerts[alertSeen.get(key)];
      existing.count = (existing.count || 1) + 1;
      if (!existing.fns) existing.fns = [existing.fn];
      if (!existing.fns.includes(a.fn)) existing.fns.push(a.fn);
    } else {
      alertSeen.set(key, dedupedAlerts.length);
      dedupedAlerts.push({ ...a, count: 1 });
    }
  }
  alerts.length = 0;
  alerts.push(...dedupedAlerts);

  // Phase 5: hotspots — rank by callers × complexity
  const byIncoming = [...fns].sort((a, b) => {
    const scoreA = a.calledBy.length * (a.complexity || 1);
    const scoreB = b.calledBy.length * (b.complexity || 1);
    return scoreB - scoreA;
  });
  const mostCalled = byIncoming.slice(0, 10).filter((f) => f.calledBy.length > 0);
  const roots = fns.filter((f) => f.calledBy.length === 0 && f.calls.length > 0);
  const leaves = fns.filter((f) => f.calls.length === 0 && f.calledBy.length > 0);
  // Hot groups: count edges per parent group
  const groupEdges = {};
  for (const f of fns) {
    const m = f.name.match(SUB_FN_NAME_RE);
    const grp = m ? m[1] : "top-level";
    groupEdges[grp] = (groupEdges[grp] || 0) + f.calls.length + f.calledBy.length;
  }
  const hotGroups = Object.entries(groupEdges)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  // Phase 6: suggested trace path — longest route from a root through call graph
  let tracePath = [];
  if (roots.length > 0) {
    const nameIdx = new Map(fns.map((f, i) => [f.name, i]));
    function longestFrom(fnName, visited) {
      if (visited.has(fnName)) return [];
      visited.add(fnName);
      const fn = fns[nameIdx.get(fnName)];
      if (!fn || fn.calls.length === 0) return [fnName];
      let best = [];
      for (const callee of fn.calls) {
        const tail = longestFrom(callee, new Set(visited));
        if (tail.length > best.length) best = tail;
      }
      return [fnName, ...best];
    }
    // Try from roots, prefer ones with most callers
    const sortedRoots = roots.sort((a, b) => b.calledBy.length - a.calledBy.length);
    for (const root of sortedRoots.slice(0, 5)) {
      const path = longestFrom(root.name, new Set());
      if (path.length > tracePath.length) tracePath = path;
    }
  }

  const lookup = buildLookupIndex(fns);

  const report = {
    file: path.basename(filepath),
    summary: {
      totalFunctions: fns.length,
      subFunctions: subFns.length,
      originalFunctions: origins.length,
      byType: types,
      maxDepth: Math.max(...subFns.map((f) => (f.name.match(/_/g) || []).length), 0),
      flattened: flattenedCount,
      suspicious: suspiciousCount,
      maxComplexity: Math.max(...fns.map((f) => f.complexity || 1), 1),
    },
    hotspots: { mostCalled, roots, leaves, hotGroups },
    tracePath,
    alerts,
    lookup,
    naming: {
      format: "_S_<parent>_<seq>_<hint>",
      collision: "_S_<parent>_L<line>_<seq>_<hint> (when name collides)",
      examples: [
        { name: "_S_0x28bed7_01_try", meaning: "Extracted from function 0x28bed7, seq 01, try body" },
        { name: "_S_constructor_07_if", meaning: "Extracted from method 'constructor', seq 07, if branch" },
        { name: "_S_l100877_03_try", meaning: "Anonymous parent at line 100877, seq 03, try body" },
        { name: "_S_program_init_vars_l1149", meaning: "Top-level program IIFE at line 1149, variable initialization" },
        { name: "_S_return_1_fn", meaning: "Inline function lifted from a return statement" },
        { name: "_S_l251_L1364_01_try vs _S_l251_L1548_01_try", meaning: "Two try blocks with same parent+seq+hint — _L<line> disambiguates by source line" },
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
    alertTraces: computeAlertTraces(fns, alerts, roots),
  };
  report.tldr = generateTLDR(report);
  return report;
}
const analyzeStructure = cachedAnalyze;

// ── Jump Table Detection ───────────────────────────────────────────

function detectJumpTable(body) {
  let hasTable = false, hasComputedCall = false;
  function scan(n) {
    if (!n || typeof n !== "object" || (hasTable && hasComputedCall)) return;
    if (t.isFunction(n)) return;
    if (t.isArrayExpression(n) && n.elements.length >= 5 &&
        n.elements.every((e) => t.isIdentifier(e) || e === null)) hasTable = true;
    if (t.isObjectExpression(n) && n.properties.length >= 5 &&
        n.properties.every((p) => (t.isNumericLiteral(p.key) || (t.isStringLiteral(p.key) && /^\d+$/.test(p.key.value))))) hasTable = true;
    if (t.isCallExpression(n) && t.isMemberExpression(n.callee) && n.callee.computed) hasComputedCall = true;
    for (const k of Object.keys(n)) {
      if (SKIP_KEYS.has(k)) continue;
      const v = n[k];
      if (Array.isArray(v)) { for (const x of v) scan(x); }
      else if (v && typeof v.type === "string") scan(v);
    }
  }
  scan(body);
  return hasTable && hasComputedCall;
}

// ── Parameter Roles ─────────────────────────────────────────────────

function detectParamRoles(fnNode) {
  const params = fnNode.params.filter((p) => t.isIdentifier(p));
  if (params.length === 0) return "";
  const roles = new Map();
  function scan(n) {
    if (!n || typeof n !== "object") return;
    if (t.isFunction(n) && n !== fnNode) return;
    if (t.isCallExpression(n) && t.isIdentifier(n.callee)) {
      const p = params.find((pp) => pp.name === n.callee.name);
      if (p) { if (!roles.has(p.name)) roles.set(p.name, new Set()); roles.get(p.name).add("cb"); }
    }
    if (t.isMemberExpression(n) && t.isIdentifier(n.object)) {
      const p = params.find((pp) => pp.name === n.object.name);
      if (p) {
        if (t.isIdentifier(n.property) && /^(getAttribute|getBoundingClientRect|addEventListener|removeEventListener|querySelector|appendChild|removeChild|setAttribute|closest|matches|classList)$/.test(n.property.name)) {
          if (!roles.has(p.name)) roles.set(p.name, new Set()); roles.get(p.name).add("elem");
        }
        if (t.isStringLiteral(n.property)) {
          if (!roles.has(p.name)) roles.set(p.name, new Set()); roles.get(p.name).add("cfg");
        }
        if (!roles.has(p.name)) roles.set(p.name, new Set()); roles.get(p.name).add("this");
      }
    }
    if (t.isAssignmentExpression(n) && t.isIdentifier(n.left)) {
      const p = params.find((pp) => pp.name === n.left.name);
      if (p) { if (!roles.has(p.name)) roles.set(p.name, new Set()); roles.get(p.name).add("out"); }
    }
    if (t.isForOfStatement(n) && t.isIdentifier(n.right)) {
      const p = params.find((pp) => pp.name === n.right.name);
      if (p) { if (!roles.has(p.name)) roles.set(p.name, new Set()); roles.get(p.name).add("iter"); }
    }
    for (const k of Object.keys(n)) {
      if (SKIP_KEYS.has(k)) continue;
      const v = n[k];
      if (Array.isArray(v)) { for (const x of v) scan(x); }
      else if (v && typeof v.type === "string") scan(v);
    }
  }
  scan(fnNode.body);
  const parts = [];
  for (const p of params) {
    const r = roles.get(p.name);
    if (r && r.size > 0) parts.push([...r].sort().join(":") + "=" + p.name);
  }
  return parts.length > 0 ? parts.join(", ") : "";
}

// ── Semantic Tags ───────────────────────────────────────────────────

function detectSemanticTags(name, stmt) {
  const tags = [];
  const body = stmt.body;
  if (!t.isBlockStatement(body)) return tags;

  // Self-modifying: fn = function... or fn = _S_...
  let selfMod = false;
  let propSetters = 0; let hasRegex = false; let hasBigArray = false;
  let buildCount = 0;

  function scan(n) {
    if (!n || typeof n !== "object") return;
    if (t.isFunction(n) && n !== stmt) return;

    // Self-modifying: fnName = function_expression
    if (t.isAssignmentExpression(n) && n.operator === "=" &&
        t.isIdentifier(n.left) && n.left.name === name) selfMod = true;

    // Property setters: this.X = ... or obj.X = ...
    if (t.isAssignmentExpression(n) &&
        t.isMemberExpression(n.left) && !n.left.computed) propSetters++;

    // Regex literals
    if (t.isRegExpLiteral(n)) hasRegex = true;

    // Large arrays
    if (t.isArrayExpression(n) && n.elements.length > 20) hasBigArray = true;

    // Object building: { key: val, ... } inside return or assignment
    if (t.isObjectExpression(n) && n.properties.length > 5) buildCount++;

    for (const k of Object.keys(n)) {
      if (SKIP_KEYS.has(k)) continue;
      const v = n[k];
      if (Array.isArray(v)) { for (const x of v) scan(x); }
      else if (v && typeof v.type === "string") scan(v);
    }
  }
  scan(body);

  if (selfMod) tags.push("self-modifying");
  // String decoder: self-modifying + returns from array lookup
  if (selfMod && body.body.length <= 5) {
    let hasArrayReturn = false;
    function scanReturn(n) {
      if (!n || typeof n !== "object") return;
      if (t.isReturnStatement(n) && n.argument && t.isMemberExpression(n.argument)) hasArrayReturn = true;
      if (t.isFunction(n) && n !== stmt) return;
      for (const k of Object.keys(n)) {
        if (SKIP_KEYS.has(k)) continue;
        const v = n[k];
        if (v && typeof v.type === "string") scanReturn(v);
      }
    }
    scanReturn(body);
    if (hasArrayReturn) tags.push("string-decoder");
  }
  if (t.isWhileStatement(body.body[0]) || t.isForStatement(body.body[0])) {
    // Check for while+switch deeper
    function hasSwitch(n) {
      if (!n || typeof n !== "object") return false;
      if (t.isSwitchStatement(n)) return true;
      if (t.isFunction(n) && n !== stmt) return false;
      for (const k of Object.keys(n)) {
        if (SKIP_KEYS.has(k)) continue;
        const v = n[k];
        if (Array.isArray(v)) { for (const x of v) { if (hasSwitch(x)) return true; } }
        else if (v && typeof v.type === "string") { if (hasSwitch(v)) return true; }
      }
      return false;
    }
    if (hasSwitch(body)) tags.push("dispatcher");
  }
  if (propSetters >= 5) tags.push("config");
  if (buildCount >= 2) tags.push("table-init");
  if (hasBigArray) tags.push("table-init");
  if (hasRegex && propSetters >= 2) tags.push("integrity-check");
  if (name.startsWith("_S_program")) tags.push("module-init");

  return tags;
}

function describeFn(fnNode) {
  const body = fnNode.body;
  if (!t.isBlockStatement(body)) return "";
  const stmts = body.body;
  const stmtCount = stmts.length;
  if (stmtCount === 0) return "[pass-through]";

  // Collect param names for callback-driven detection
  const paramNames = new Set(fnNode.params.filter((p) => t.isIdentifier(p)).map((p) => p.name));

  // Scan body for patterns
  let returnCount = 0, lastReturn = null;
  let hasThrow = false, hasCallbackCall = false, hasMemberAssign = false;
  let returnsObject = false;

  function scan(n) {
    if (!n || typeof n !== "object") return;
    if (t.isReturnStatement(n)) {
      if (n.argument) { returnCount++; lastReturn = n.argument; }
      if (t.isObjectExpression(n.argument)) returnsObject = true;
    }
    if (t.isThrowStatement(n)) hasThrow = true;
    // Callback-driven: a param is used as callee
    if (t.isCallExpression(n) && t.isIdentifier(n.callee) && paramNames.has(n.callee.name)) hasCallbackCall = true;
    // Side effects: assignment to member expression (modifies external state)
    if (t.isAssignmentExpression(n) && t.isMemberExpression(n.left)) hasMemberAssign = true;
    if (t.isFunction(n)) return;
    for (const k of Object.keys(n)) {
      if (SKIP_KEYS.has(k)) continue;
      const v = n[k];
      if (Array.isArray(v)) { for (const x of v) scan(x); }
      else if (v && typeof v.type === "string") scan(v);
    }
  }
  scan(body);

  // Build primary description
  let desc;
  if (returnCount > 1) desc = `returns via ${returnCount} paths`;
  else if (returnCount === 1) {
    const ret = lastReturn;
    if (t.isCallExpression(ret) && t.isIdentifier(ret.callee)) desc = `calls → ${ret.callee.name}`;
    else if (t.isCallExpression(ret)) desc = "calls expr";
    else if (t.isIdentifier(ret)) desc = "returns arg";
    else if (t.isStringLiteral(ret)) desc = "returns str";
    else if (t.isNumericLiteral(ret)) desc = "returns num";
    else if (t.isConditionalExpression(ret)) desc = "returns conditional";
    else if (t.isBinaryExpression(ret)) desc = "returns expr";
    else if (t.isMemberExpression(ret)) desc = "returns prop";
    else if (t.isObjectExpression(ret)) desc = returnsObject ? "factory" : "returns object";
    else desc = "returns value";
  } else {
    desc = `void, ${stmtCount}S`;
  }

  // Append additional signals
  const tags = [];
  if (hasCallbackCall) tags.push("callback-driven");
  if (hasThrow) tags.push("can throw");
  if (hasMemberAssign && returnCount === 0) tags.push("side-effects");

  return tags.length > 0 ? `[${desc}; ${tags.join(", ")}]` : `[${desc}]`;
}

// ── Alert Trace ────────────────────────────────────────────────────

function computeAlertTraces(fns, alerts, roots) {
  if (!alerts.length || !roots.length) return [];
  const nameIdx = new Map(fns.map((f, i) => [f.name, i]));
  const traces = [];

  for (const a of alerts) {
    let shortest = null;
    for (const root of roots) {
      const path = bfsPath(root.name, a.fn, nameIdx, fns);
      if (path && (!shortest || path.length < shortest.length)) shortest = path;
    }
    if (shortest && shortest.length > 1) {
      traces.push({ fn: a.fn, label: a.label, path: shortest });
    }
  }
  // Deduplicate by fn
  const seen = new Set();
  return traces.filter((t) => {
    const key = t.fn + t.label;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 20);
}

function bfsPath(from, to, nameIdx, fns) {
  if (from === to) return [from];
  const visited = new Set([from]);
  const queue = [[from]];
  while (queue.length > 0) {
    const path = queue.shift();
    const last = path[path.length - 1];
    const fn = fns[nameIdx.get(last)];
    if (!fn) continue;
    for (const callee of (fn.calls || [])) {
      if (callee === to) return [...path, to];
      if (!visited.has(callee)) {
        visited.add(callee);
        queue.push([...path, callee]);
      }
    }
  }
  return null;
}

// ── TL;DR Summary ──────────────────────────────────────────────────

function generateTLDR(report) {
  const { summary, hotspots, alerts } = report;
  const parts = [];

  parts.push(`${summary.totalFunctions} functions`);
  if (summary.subFunctions > 0) parts.push(`(${summary.subFunctions} extracted sub-fns, ${summary.originalFunctions} original)`);

  if (alerts && alerts.length > 0) {
    const bySev = {};
    for (const a of alerts) {
      bySev[a.severity] = (bySev[a.severity] || 0) + 1;
    }
    const sevParts = [];
    if (bySev.critical) sevParts.push(`${bySev.critical} critical`);
    if (bySev.high) sevParts.push(`${bySev.high} high`);
    if (bySev.medium) sevParts.push(`${bySev.medium} medium`);
    if (sevParts.length > 0) parts.push(`${sevParts.join(", ")} alerts`);
  }

  if (summary.flattened > 0) parts.push(`${summary.flattened} flattened (while+switch)`);
  if (summary.suspicious > 0) parts.push(`${summary.suspicious} suspicious patterns`);
  if (summary.maxComplexity > 10) parts.push(`max complexity ${summary.maxComplexity}`);

  if (hotspots && hotspots.roots && hotspots.roots.length > 0) {
    parts.push(`${hotspots.roots.length} entry point${hotspots.roots.length > 1 ? "s" : ""}`);
  }

  return parts.join(" · ");
}

// ── Signal Density ────────────────────────────────────────────────

function computeDensity(functions, file) {
  if (functions.length === 0) return "N/A";
  const totalFnLines = functions.reduce((s, f) => {
    return s + (f.lines[0] && f.lines[1] ? f.lines[1] - f.lines[0] + 1 : 0);
  }, 0);
  // Estimate total lines from the last function's end line
  const lastFn = functions[functions.length - 1];
  const totalLines = lastFn.lines[1] || 100;
  const pct = Math.round((totalFnLines / totalLines) * 100);
  return `${pct}% active code, ${100 - pct}% data/other`;
}

// ── Domain Classification ─────────────────────────────────────────

function classifyDomain(filepath) {
  try {
    const src = fs.readFileSync(filepath, "utf-8");
    const scored = []; // [{tag, score}]

    for (const rule of DOMAIN_RULES) {
      // Extra: needs additional match
      if (rule.extra && !rule.extra.test(src)) continue;
      // Exclude: skip if excluded pattern matches
      if (rule.exclude && rule.exclude.test(src)) continue;

      // Count matches
      const matches = src.match(new RegExp(rule.regex, "gi"));
      const count = matches ? matches.length : 0;
      if (count === 0) continue;

      // MinCount: need > N matches
      if (rule.minCount && count <= rule.minCount) continue;

      let score = count;
      // Exclusive rules get higher weight
      if (rule.exclusive) score *= 2;
      // Framework rules get higher weight (more informative than generic patterns)
      if (rule.framework) score *= 3;

      scored.push({ tag: rule.tag, score, framework: !!rule.framework });
    }

    // Compound rules
    const hasFetch = /\bfetch\s*\(/.test(src);
    const hasXHR = /\bXMLHttpRequest\b/.test(src);
    const hasAxios = /\baxios\b/.test(src);
    if ((hasFetch && (hasXHR || /https?:\/\/[^\s"']+/.test(src))) || hasAxios) {
      scored.push({ tag: "Network", score: 5 });
    }
    const apiPaths = (src.match(/\/api\//g) || []).length;
    if (apiPaths > 5) scored.push({ tag: "API Router", score: apiPaths });
    const evals = (src.match(/\beval\s*\(/g) || []).length;
    if (evals > 5) scored.push({ tag: "Eval-heavy", score: evals });

    // Two-tier: frameworks first, then feature domains by score
    const frameworks = scored.filter(d => d.framework).sort((a, b) => b.score - a.score);
    const features = scored.filter(d => !d.framework).sort((a, b) => b.score - a.score);

    const result = [];
    // Frameworks get first priority (up to 2)
    for (const f of frameworks) { if (result.length < 2) result.push(f); }
    // Fill remaining slots with top feature domains
    for (const f of features) { if (result.length < 3) result.push(f); }

    if (result.length === 0) return "General JS";
    return result.map(d => d.tag).join(" + ");
  } catch (e) {
    return "Unknown";
  }
}

function categorizeFn(name, fn, meta) {
  if (meta && meta.heavyHex) return "data";
  if (!name.startsWith(SUB_FN_PREFIX)) return "core";

  const labels = meta && meta.alertLabels ? meta.alertLabels : null;
  const src = meta && meta.srcText ? meta.srcText : "";
  const desc = fn.description || "";

  // Framework detection — tag known framework internals
  for (const pattern of FRAMEWORK_PATTERNS) {
    if (pattern.test(src)) return "framework";
  }

  // Domain-specific checks FIRST — take priority over structural patterns
  if (labels && labels.has("Network")) return "network";
  if (labels && labels.has("Crypto")) return "crypto";
  if (labels && labels.has("Eval / Dynamic")) return "dynamic";

  for (const rule of CATEGORY_RULES) {
    if (rule.regex.test(src)) return rule.category;
  }

  // Behavioral descriptors
  if (/_setTimeout|_setInterval|_debounce|_throttle/.test(name)) return "timer";
  if (desc.includes("factory") || desc.includes("construct")) return "construct";
  if (desc.includes("pass-through") || desc.includes("returns arg") || desc.includes("calls expr")) return "delegate";
  if (/arguments\[/.test((fn.suspicious || []).join(" "))) return "varargs";
  if (/\b(__esModule|Object\.defineProperty|d\s*\(\s*exports|exports\s*\[)\b/.test(src)) return "boilerplate";
  // Callback-driven handlers (have cb= but not pure pass-through)
  if (desc.includes("callback-driven") && !desc.includes("pass-through")) return "handler";
  // Side-effect functions (mutate state but not callback-driven)
  if (desc.includes("side-effects") && !desc.includes("callback-driven")) return "sideeffect";

  // Structural patterns — AFTER domain checks so try/catch with domain code wins
  if (name.includes(SUB_FN_PREFIX + "return_") || name.includes(SUB_FN_PREFIX + "return_L")) return "callback";
  if (/_(if|else|try|catch|case)(?:_\d+)?$/.test(name)) return "branch";

  return "other";
}

// ── Mechanical Function Detection ──────────────────────────────────────

function detectMechanical(fnNode) {
  const body = fnNode.body;
  if (!t.isBlockStatement(body)) return null;
  const stmts = body.body;
  const paramNames = new Set(fnNode.params.filter((p) => t.isIdentifier(p)).map((p) => p.name));

  // Pattern 1: pure forward — single return CallExpression, params passed through
  if (stmts.length === 1 && t.isReturnStatement(stmts[0]) && stmts[0].argument) {
    const ret = stmts[0].argument;
    if (t.isCallExpression(ret) && t.isIdentifier(ret.callee)) {
      const argsAreParams = ret.arguments.every((a) => t.isIdentifier(a) && paramNames.has(a.name));
      if (argsAreParams && ret.arguments.length === paramNames.size) {
        return { type: "forward", detail: "→ " + ret.callee.name };
      }
    }
  }

  // Pattern 2: pure computation — no CallExpression anywhere in body
  let hasCall = false;
  function scanCalls(n) {
    if (!n || typeof n !== "object" || hasCall) return;
    if (t.isCallExpression(n)) { hasCall = true; return; }
    if (t.isFunction(n)) return;
    for (const k of Object.keys(n)) {
      if (SKIP_KEYS.has(k)) continue;
      const v = n[k];
      if (Array.isArray(v)) { for (const x of v) scanCalls(x); }
      else if (v && typeof v.type === "string") scanCalls(v);
    }
  }
  scanCalls(body);
  if (!hasCall && stmts.length <= 5) {
    return { type: "pure computation", detail: `${stmts.length} stmts, cc=1` };
  }

  // Pattern 3: no external references (only params + locally declared)
  const declared = new Set(paramNames);
  function collectDecls(n) {
    if (!n || typeof n !== "object") return;
    if (t.isVariableDeclaration(n)) {
      for (const d of n.declarations) {
        if (t.isIdentifier(d.id)) declared.add(d.id.name);
      }
    }
    if (t.isFunction(n)) return;
    for (const k of Object.keys(n)) {
      if (SKIP_KEYS.has(k)) continue;
      const v = n[k];
      if (Array.isArray(v)) { for (const x of v) collectDecls(x); }
      else if (v && typeof v.type === "string") collectDecls(v);
    }
  }
  collectDecls(body);

  let hasExternal = false;
  function scanRefs(n) {
    if (!n || typeof n !== "object" || hasExternal) return;
    if (t.isIdentifier(n) && !declared.has(n.name)) {
      // Allow built-in globals
      if (!/^(Object|Array|String|Number|Boolean|Function|Math|Date|RegExp|Error|TypeError|undefined|NaN|Infinity|console|JSON|parseInt|parseFloat|isNaN|isFinite|null|true|false|arguments|this|window|document|global|globalThis)$/.test(n.name)) {
        hasExternal = true;
      }
    }
    if (t.isFunction(n)) return;
    for (const k of Object.keys(n)) {
      if (SKIP_KEYS.has(k)) continue;
      const v = n[k];
      if (Array.isArray(v)) { for (const x of v) scanRefs(x); }
      else if (v && typeof v.type === "string") scanRefs(v);
    }
  }
  scanRefs(body);
  if (!hasExternal) {
    return { type: "closed", detail: `self-contained, cc=1` };
  }

  return null;
}

module.exports = {
  splitWords, buildLookupIndex, analyzeStructureFallback, analyzeStructure,
  detectJumpTable, detectParamRoles, detectSemanticTags, describeFn,
  computeAlertTraces, bfsPath, generateTLDR, computeDensity, classifyDomain,
  categorizeFn, detectMechanical,
};

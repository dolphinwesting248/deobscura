// Structure report: Markdown output of function analysis
const { parser, t, fs, path, ALERT_PATTERNS } = require("./config");

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
  const subFns = fns.filter((f) => f.name.startsWith("_S_"));
  const origins = fns.filter((f) => !f.name.startsWith("_S_"));
  const types = {};
  for (const f of subFns) {
    const n = f.name;
    if (n.match(/_try$/)) types.tryCatch = (types.tryCatch || 0) + 1;
    else if (n.match(/_if$/) || n.match(/_else$/)) types.ifElse = (types.ifElse || 0) + 1;
    else if (n.includes("_iife") || n.includes("_init_")) types.iife = (types.iife || 0) + 1;
    else if (n.includes("_case")) types.switch = (types.switch || 0) + 1;
    else if (n.startsWith("_S_return_")) types.inlineFn = (types.inlineFn || 0) + 1;
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

  // Phase 6: hotspots (same as AST path)
  const byIncoming = [...fns].sort((a, b) => b.calledBy.length - a.calledBy.length);
  const mostCalled = byIncoming.slice(0, 10).filter((f) => f.calledBy.length > 0);
  const roots = fns.filter((f) => f.calledBy.length === 0 && f.calls.length > 0);
  const leaves = fns.filter((f) => f.calls.length === 0 && f.calledBy.length > 0);
  const groupEdges = {};
  for (const f of fns) {
    const m = f.name.match(/^_S_(.+?)_\d{2}_/);
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
      ],
      hints: { try: "try block body", catch: "catch handler", if: "if branch", else: "else branch", fn: "inline function" },
    },
    functions: fns,
  };
  report.tldr = generateTLDR(report);
  return report;
}

function analyzeStructure(filepath, opts) {
  const denoise = opts && opts.denoise;
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
          if (k === "start" || k === "end" || k === "loc" ||
              k === "leadingComments" || k === "trailingComments" || k === "innerComments") continue;
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
          if (k === "start" || k === "end" || k === "loc" ||
              k === "leadingComments" || k === "trailingComments" || k === "innerComments") continue;
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
          if (k === "start" || k === "end" || k === "loc" ||
              k === "leadingComments" || k === "trailingComments" || k === "innerComments") continue;
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
        // arguments[i]
        if (t.isMemberExpression(n) && t.isIdentifier(n.object) && n.object.name === "arguments" &&
            !t.isIdentifier(n.property)) {
          suspicious.push("arguments[i]");
        }
        // __proto__ assignment
        if (t.isAssignmentExpression(n) && t.isMemberExpression(n.left) &&
            t.isIdentifier(n.left.property, { name: "__proto__" })) {
          suspicious.push("__proto__");
        }
        if (t.isFunction(n)) return;
        for (const k of Object.keys(n)) {
          if (k === "start" || k === "end" || k === "loc" ||
              k === "leadingComments" || k === "trailingComments" || k === "innerComments") continue;
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
      fns[calleeIdx].calledBy.push(callerName);
    }
    for (const k of Object.keys(node)) {
      if (k === "start" || k === "end" || k === "loc" ||
          k === "leadingComments" || k === "trailingComments" || k === "innerComments") continue;
      const v = node[k];
      if (Array.isArray(v)) { for (const x of v) walk(x, callerName); }
      else if (v && typeof v.type === "string") walk(v, callerName);
    }
  }
  for (const stmt of ast.program.body) {
    if (t.isFunctionDeclaration(stmt) && stmt.id) walk(stmt.body, stmt.id.name);
  }

  // Phase 3: summary
  const subFns = fns.filter((f) => f.name.startsWith("_S_"));
  const origins = fns.filter((f) => !f.name.startsWith("_S_"));
  const types = {};
  for (const f of subFns) {
    const n = f.name;
    if (n.match(/_try$/)) types.tryCatch = (types.tryCatch || 0) + 1;
    else if (n.match(/_if$/) || n.match(/_else$/)) types.ifElse = (types.ifElse || 0) + 1;
    else if (n.includes("_iife") || n.includes("_init_")) types.iife = (types.iife || 0) + 1;
    else if (n.includes("_case")) types.switch = (types.switch || 0) + 1;
    else if (n.startsWith("_S_return_")) types.inlineFn = (types.inlineFn || 0) + 1;
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
      for (const k of Object.keys(node)) {
        if (k === "start" || k === "end" || k === "loc" ||
            k === "leadingComments" || k === "trailingComments" || k === "innerComments") continue;
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

  // Phase 5: hotspots — function heat rankings
  const byIncoming = [...fns].sort((a, b) => b.calledBy.length - a.calledBy.length);
  const mostCalled = byIncoming.slice(0, 10).filter((f) => f.calledBy.length > 0);
  const roots = fns.filter((f) => f.calledBy.length === 0 && f.calls.length > 0);
  const leaves = fns.filter((f) => f.calls.length === 0 && f.calledBy.length > 0);
  // Hot groups: count edges per parent group
  const groupEdges = {};
  for (const f of fns) {
    const m = f.name.match(/^_S_(.+?)_\d{2}_/);
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
      if (k === "start" || k === "end" || k === "loc" ||
          k === "leadingComments" || k === "trailingComments" || k === "innerComments") continue;
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
      if (k === "start" || k === "end" || k === "loc" ||
          k === "leadingComments" || k === "trailingComments" || k === "innerComments") continue;
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
      if (k === "start" || k === "end" || k === "loc" ||
          k === "leadingComments" || k === "trailingComments" || k === "innerComments") continue;
      const v = n[k];
      if (Array.isArray(v)) { for (const x of v) scan(x); }
      else if (v && typeof v.type === "string") scan(v);
    }
  }
  scan(body);

  if (selfMod) tags.push("self-modifying");
  if (t.isWhileStatement(body.body[0]) || t.isForStatement(body.body[0])) {
    // Check for while+switch deeper
    function hasSwitch(n) {
      if (!n || typeof n !== "object") return false;
      if (t.isSwitchStatement(n)) return true;
      if (t.isFunction(n) && n !== stmt) return false;
      for (const k of Object.keys(n)) {
        if (k === "start" || k === "end" || k === "loc" ||
            k === "leadingComments" || k === "trailingComments" || k === "innerComments") continue;
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
      if (k === "start" || k === "end" || k === "loc" ||
          k === "leadingComments" || k === "trailingComments" || k === "innerComments") continue;
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
    const tags = [];
    // Bundlers — check FIRST, take priority
    if (/\bself\.(rspack|webpack)(Chunk|_require_)/.test(src)) tags.push("rspack/webpack chunk");
    else if (/\b__webpack_require__\b|\b__webpack_modules__\b/.test(src)) tags.push("webpack bundle");
    if (/\bTURBOPACK\b|\bturbopack\b/.test(src)) tags.push("turbopack runtime");
    if (/\bmodule\.exports\b|\bexports\[/.test(src) && /\brequire\s*\(/.test(src)) tags.push("CommonJS");
    if (/\bdefine\s*\(\s*(['"]|function)/.test(src)) tags.push("AMD");
    // Framework detection — before generic DOM/network
    if (/\b__VUE__\b|\bvue\b.*\breactive\b|\bVue\b.*\bcomponent\b/i.test(src)) tags.push("Vue");
    if (/\b__REACT_DEVTOOLS_GLOBAL_HOOK__\b|\bReactDOM\b/.test(src)) tags.push("React");
    if (/\b__ANGULAR__\b|\b@NgModule\b|\bzone\.js\b/i.test(src)) tags.push("Angular");
    if (/\b__svelte\b|\bSvelte\b.*\bcompile\b/i.test(src)) tags.push("Svelte");
    if (/\b__NEXT_DATA__\b|\b__next\b/i.test(src)) tags.push("Next.js");
    if (/\b__nuxt\b|\bNuxt\b/i.test(src)) tags.push("Nuxt");
    // Module runtimes
    if (/\bimportScripts\b|\bWorker\b.*\bimport\b/i.test(src)) tags.push("Worker runtime");
    if (/\bprocess\.(?!env)/.test(src)) tags.push("Node.js");
    // DOM — require specific manipulation patterns, not just window/document
    if (/\binnerHTML\b|\bcreateElement\b|\bappendChild\b|\bquerySelector\b|\bgetElementById\b/.test(src)) tags.push("DOM manipulation");
    if (/\baddEventListener\b/.test(src) && (src.match(/\baddEventListener\b/g) || []).length > 3) tags.push("Event-driven");
    // Network — require actual HTTP client patterns
    const hasFetch = /\bfetch\s*\(/.test(src);
    const hasXHR = /\bXMLHttpRequest\b/.test(src);
    const hasAxios = /\baxios\b/.test(src);
    if ((hasFetch && hasXHR) || hasAxios || (hasFetch && /https?:\/\/[^\s"']+/g.test(src))) tags.push("Network");
    if (/\b(crypto|encrypt|decrypt|hmac|md5|sha\d+)\b/i.test(src)) tags.push("Crypto");
    // Specific domain signatures
    if (/\b(sign\w*(?:V2|Init|Request)?\s*\(|xhsSign|_sign\b|signKey)\b/i.test(src)) tags.push("Signing");
    const apiPaths = (src.match(/\/api\//g) || []).length;
    if (apiPaths > 5) tags.push("API Router");
    if (/\b(protobuf|protobufjs|\.(?:encode|decode|verify|fromObject|toObject)\s*\()/.test(src) &&
        !/\b(Text(?:Encoder|Decoder)|encodeURI(?:Component)?|decodeURI(?:Component)?)\b/.test(src)) tags.push("Protobuf");
    if (/\b(websocket|ws\b\.|gateway|socket\.io|Reconnect)|WebSocket\b/i.test(src)) tags.push("WebSocket");
    // Graphics — require specific rendering API patterns
    if (/\bWebGL\b|\bgetContext\s*\(\s*['"]2d['"]\s*\)|drawImage\b|createTexture\b/i.test(src)) tags.push("Graphics");
    if (/\bprototype\s*\.\s*\w+\s*=/.test(src)) tags.push("Prototype-patched");
    const evals = (src.match(/\beval\s*\(/g) || []).length;
    if (evals > 5) tags.push("Eval-heavy");
    return tags.length > 0 ? tags.join(" + ") : "General JS";
  } catch (e) {
    return "Unknown";
  }
}

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

> Previous: 0-prompt.md  →  **Now: 1-structure.md**  →  Next: 2-index.txt → jump to main.js
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

${tracePath && tracePath.length > 1 ? `**Trace:** \`${tracePath.join("` → `")}\`\n\n` : ""}${hotspots.mostCalled.length > 0 ? `| Rank | Type | Details |
|------|------|---------|
${hotspots.mostCalled.map((f, i) => `| ${i + 1} | Most-called | \`${f.name}\` — called by ${f.calledBy.length} functions, calls ${f.calls.length} others |`).join("\n")}
` : ""}${hotspots.roots.length > 0 ? `| — | Roots (${hotspots.roots.length}) | Entry points: ${hotspots.roots.slice(0, 8).map((f) => `\`${f.name}\``).join(", ")}${hotspots.roots.length > 8 ? " …" : ""} |\n` : ""}${hotspots.leaves.length > 0 ? `| — | Leaves (${hotspots.leaves.length}) | Terminal functions: ${hotspots.leaves.slice(0, 8).map((f) => `\`${f.name}\``).join(", ")}${hotspots.leaves.length > 8 ? " …" : ""} |\n` : ""}${hotspots.mostCalled.length === 0 && hotspots.roots.length === 0 && hotspots.leaves.length === 0 ? "_No cross-function calls detected._\n" : ""}
## String Alerts

${alerts.length === 0 ? "_No significant patterns detected._\n" : (() => { const deduped = []; const seen = new Map(); for (const a of alerts) { const key = a.label + "|" + (a.matches||[])[0]; if (seen.has(key)) { const prev = deduped[seen.get(key)]; if (!prev._dupes) prev._dupes = []; prev._dupes.push(a.fn + " L" + a.line); continue; } seen.set(key, deduped.length); deduped.push({...a}); } return `| Severity | Pattern | Function | Line | Trace | Matches |
|----------|---------|----------|------|-------|---------|
${deduped.map((a) => {
    const tr = (report.alertTraces || []).find((t) => t.fn === a.fn);
    const afn = functions.find((f) => f.name === a.fn);
    const traceStr = tr ? tr.path.join(" → ") : (afn && afn.calledBy.length === 0) ? "no callers" : "no path";
    const dupes = a._dupes ? " (+ " + a._dupes.length + " dupes)" : "";
    return `| ${a.severity} | ${a.label} | \`${a.fn}\` | ${a.line} | ${traceStr} | ${a.matches.join(" · ")}${dupes} |`;
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
    const idx = result.indexOf("\n## Naming Convention\n");
    if (idx > 0) return result.substring(0, idx) + "\n---\n*Naming convention: see summary.md*\n";
  }
  return result;
}

// ── Analysis Prompt ─────────────────────────────────────────────────

function generatePromptFile(outputDir) {
  const mainPath = path.join(outputDir, "main.js");
  if (!fs.existsSync(mainPath)) return;
  const report = analyzeStructure(mainPath);
  const { file, summary, functions, hotspots, alerts, tracePath } = report;
  const domain = classifyDomain(mainPath);

  // String decoder detection
  const selfMod = functions.filter((f) => (f.semanticTags || []).includes("self-modifying"))
    .sort((a, b) => b.calledBy.length - a.calledBy.length);
  const decoder = selfMod.length > 0 ? selfMod[0] : null;

  // Entry point
  const roots = (hotspots.roots || []).filter((f) => f.calls.length > 0)
    .sort((a, b) => (b.calledBy.length + b.calls.length) - (a.calledBy.length + a.calls.length));

  // Top 5 by interest score
  const scored = functions.map((f) => ({
    ...f,
    score: (alerts.filter((a) => a.fn === f.name).length * 3) + (f.complexity || 1) + Math.min(f.calledBy.length, 20)
  })).sort((a, b) => b.score - a.score).slice(0, 5);

  // Pass-through count
  const passThrough = functions.filter((f) => (f.description || "").includes("pass-through")).length;

  const content = `You are analyzing deobfuscated JavaScript from \`${file}\`. The preprocessor already determined:

## Architecture
- ${summary.totalFunctions} functions (${summary.originalFunctions} original, ${summary.subFunctions} extracted)
- Domain: **${domain}**
- ${summary.flattened} flattened, ${summary.suspicious} suspicious patterns, max complexity ${summary.maxComplexity}
- Code density: ${computeDensity(functions, file)}
${decoder ? `- **String decoder**: \`${decoder.name}\` (L${decoder.lines[0]}) — self-modifying lookup, called by ${decoder.calledBy.length} functions. Strings are NOT yet decoded — you will see opaque calls like \`_0x13f90f(0x1818)\`.` : ""}
${roots.length > 0 ? `- **Entry point**: \`${roots[0].name}\` (L${roots[0].lines[0]}) → ${roots[0].calls.slice(0,5).join(", ")}${roots[0].calls.length > 5 ? " +" + (roots[0].calls.length - 5) : ""}` : ""}

## Alerts (${alerts.length})
${alerts.length > 0 ? alerts.filter((a, i) => i < 10).map((a) => `- [${a.severity}] **${a.label}** in \`${a.fn}\` L${a.line}: ${(a.matches || []).slice(0, 3).join(", ")}`).join("\n") : "_No security alerts detected._"}

## Start Here (top 5 by interest score)
${scored.map((f, i) => {
    const why = [];
    if (alerts.some((a) => a.fn === f.name)) why.push("alerts");
    if (f.flat) why.push("flattened");
    if ((f.suspicious || []).length > 0) why.push("suspicious");
    if (f.complexity > 5) why.push("cc=" + f.complexity);
    const tags = f.semanticTags || [];
    return `${i + 1}. \`${f.name}\` (L${f.lines[0]}-${f.lines[1]}) [${why.join(", ") || "core"}] — ${(f.description || "").replace(/[[\]]/g, "")}${tags.length > 0 ? " [" + tags.join(", ") + "]" : ""}`;
  }).join("\n")}

## Skip
${passThrough} pass-through functions (zero logic). See \`2-index.txt\` for full function catalog.

## Reading Path
1. **This file** (0-prompt.md) — architecture, alerts, top 5 functions to start with
2. **1-structure.md** — call graph, hotspots, full alert traces, naming convention
3. **2-index.txt** — function catalog with line numbers → jump to \`main.js\`
`;
  const outPath = path.join(outputDir, "0-prompt.md");
  fs.writeFileSync(outPath, content, "utf-8");
  console.log(`  prompt: ${outPath}`);
}

function runStructure(input, outputDir, opts) {
  const afterPath = path.join(outputDir, "main.js");
  if (!fs.existsSync(afterPath)) {
    console.log("  Structure report skipped: no output file found");
    return null;
  }
  const report = analyzeStructure(afterPath, opts);
  report._filepath = afterPath;
  const outPath = path.join(outputDir, "1-structure.md");
  const content = generateMarkdown(report, opts);
  fs.writeFileSync(outPath, content, "utf-8");
  console.log(`  1-structure: ${outPath}`);
  return report;
}

// ── Compact Index ──────────────────────────────────────────────────

function generateIndex(outputDir, opts) {
  const mainPath = path.join(outputDir, "main.js");
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
  lines.push("_Previous: 1-structure.md  →  **Now: 2-index.txt**  →  Jump to main.js by line number._");
  lines.push("");

  // Entry points
  const roots = (hotspots.roots || []).filter((f) => f.calls.length > 0);
  if (roots.length > 0) {
    lines.push("## entry");
    for (const f of roots) {
      const flags = [f.flat ? "FLAT" : "", ...(f.suspicious || [])].filter(Boolean).join(" ");
      lines.push(`${f.name} | L${f.lines[0]}-${f.lines[1]} | cc=${f.complexity || 1} | → ${f.calls.join(", ") || "—"}${flags ? " | " + flags : ""}`);
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
      const flines = f.lines[0] ? `L${f.lines[0]}` : "?";
      lines.push(`${f.name} | ${flines} | ${(f.suspicious || []).join(", ")}`);
    }
    lines.push("");
  }

  // Flattened functions
  const flatFns = functions.filter((f) => f.flat);
  if (flatFns.length > 0) {
    lines.push("## flat");
    for (const f of flatFns) {
      const flines = f.lines[0] ? `L${f.lines[0]}` : "?";
      lines.push(`${f.name} | ${flines} | cc=${f.complexity || 1} | while+switch`);
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
  const groupLabels = { core: "Core runtime", branch: "Branches", callback: "Callbacks", data: "Data tables", network: "Network", websocket: "WebSocket", crypto: "Crypto", parser: "Parser", i18n: "i18n", polyfill: "Polyfill", filesystem: "Filesystem", timer: "Timers", construct: "Constructors", delegate: "Delegates", varargs: "Varargs", boilerplate: "Webpack boilerplate", other: "Other" };

  for (const [cat, fns] of Object.entries(groups)) {
    if (fns.length === 0) continue;
    lines.push(`## fn/${cat}  (${fns.length})`);
    for (const f of fns) {
      const flines = f.lines[0] ? `L${f.lines[0]}-${f.lines[1]}` : "?";
      const meta = fnMeta.get(f.name) || { totalLines: 0, stmts: f.bodyLen, heavyHex: false };
      const size = `${meta.totalLines}L/${meta.stmts}S/${f.params}P`;
      const calls = f.calls.length > 0 ? " → " + f.calls.join(", ") : "";
      const calledBy = f.calledBy.length > 0 ? " ⇐ " + f.calledBy.slice(0, 5).join(", ") + (f.calledBy.length > 5 ? " +" + (f.calledBy.length - 5) : "") : f.calls.length > 0 ? " root" : "";
      const semTags = (f.semanticTags || []).join(" ");
      const desc = f.description || "";
      const flags = [
        meta.heavyHex ? "DATA" : "",
        f.flat ? "FLAT" : "",
        ...(f.suspicious || []),
      ].filter(Boolean).join(" ");
      const roles = f.paramRoles || "";
      const extras = [roles, semTags, desc, flags].filter(Boolean).join(" ; ");
      lines.push(`${f.name} | ${flines} | ${size} | cc=${f.complexity || 1}${calls}${calledBy}${extras ? " | " + extras : ""}`);
    }
    lines.push("");
  }

  const outPath = path.join(outputDir, "2-index.txt");
  fs.writeFileSync(outPath, lines.join("\n"), "utf-8");
  console.log(`  2-index: ${outPath}`);
}

function categorizeFn(name, fn, meta) {
  if (meta && meta.heavyHex) return "data";
  if (!name.startsWith("_S_")) return "core";

  const labels = meta && meta.alertLabels ? meta.alertLabels : null;
  const src = meta && meta.srcText ? meta.srcText : "";
  const desc = fn.description || "";

  // Domain-specific checks FIRST — take priority over structural patterns
  if (labels && labels.has("Network")) return "network";
  if (labels && labels.has("Crypto")) return "crypto";
  if (labels && labels.has("Eval / Dynamic")) return "dynamic";

  if (/\b(axios|fetch|xhr\b|XMLHttpRequest|User-Agent|responseType|rateLimit|FormData|x-www-form)\b/i.test(src)) return "network";
  if (/\b(websocket|ws\.|readyState|WebSocket|handshake|close code|terminate|ping\b|pong\b|subprotocol|permessage-deflate|_socket\b)\b/i.test(src)) return "websocket";
  if (/\b(crypto|sha512|sha256|hmac|md5|encrypt|decrypt|sign\b|cipher\b|hash\b|randomBytes|pbkdf2)\b/i.test(src)) return "crypto";
  if (/\b(yaml|parser|scalar|blockMap|blockSeq|flowSeq|resolved\b|YAML\b)\b/i.test(src)) return "parser";
  if (/\b(i18n|i18next|translat|lng\b|interpolat|plural|namespace|resStore|ns\b)\b/i.test(src)) return "i18n";
  if (/\b(core-js|polyfill|prototype\.\w+\s*=\s*function|__core-js_shared__)\b/i.test(src)) return "polyfill";
  if (/\b(fs\.|fse\.|chmod|chown|statSync|mkdir|readFile|writeFile|copyFile|unlink|Buffer\.|glob\b|readdir|rmSync)\b/i.test(src)) return "filesystem";

  // Behavioral descriptors
  if (/_setTimeout|_setInterval|_debounce|_throttle/.test(name)) return "timer";
  if (desc.includes("factory") || desc.includes("construct")) return "construct";
  if (desc.includes("pass-through") || desc.includes("returns arg") || desc.includes("calls expr")) return "delegate";
  if (/arguments\[/.test((fn.suspicious || []).join(" "))) return "varargs";
  if (/\b(__esModule|Object\.defineProperty|d\s*\(\s*exports|exports\s*\[)\b/.test(src)) return "boilerplate";

  // Structural patterns — AFTER domain checks so try/catch with domain code wins
  if (name.includes("_S_return_") || name.includes("_S_return_L")) return "callback";
  if (/_(if|else|try|catch|case)(?:_\d+)?$/.test(name)) return "branch";

  return "other";
}

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

module.exports = { analyzeStructure, generateMarkdown, generateIndex, generateCrossSummary, runStructure, generatePromptFile, writeCrossReadme, applyTierFilter };

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
      if (k === "start" || k === "end" || k === "loc" ||
          k === "leadingComments" || k === "trailingComments" || k === "innerComments") continue;
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
      if (k === "start" || k === "end" || k === "loc" ||
          k === "leadingComments" || k === "trailingComments" || k === "innerComments") continue;
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
      if (k === "start" || k === "end" || k === "loc" ||
          k === "leadingComments" || k === "trailingComments" || k === "innerComments") continue;
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

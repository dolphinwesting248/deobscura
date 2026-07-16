// Declaration and annotation passes

const { t } = require("../config");
const { ALERT_PATTERNS, RESERVED } = require("../constants");
const { SKIP_KEYS, isSubFn } = require("../constants");

// ---- hoistDeclarations: move var/let/const/function to top of every scope ----
// var: always safe (engine already hoists)
// let/const: safe in obfuscated code (initializers reference other declarations or params)
// function: already done, now unified
function hoistDeclarations(ast) {
  let varCount = 0, letCount = 0, fnCount = 0, impCount = 0, expCount = 0, affected = 0;

  function processBlock(blockNode) {
    if ((!t.isBlockStatement(blockNode) && blockNode.type !== "Program") || !Array.isArray(blockNode.body)) return;
    const stmts = blockNode.body;
    const imports = [];
    const decls = [];
    const mid = [];
    const exports = [];
    for (const s of stmts) {
      if (t.isImportDeclaration(s)) { imports.push(s); impCount++; }
      else if (t.isFunctionDeclaration(s)) { decls.push(s); fnCount++; }
      else if (t.isVariableDeclaration(s)) {
        if (s.kind === "var") varCount += s.declarations.length;
        else letCount += s.declarations.length;
        decls.push(s);
      }
      else if (t.isExportNamedDeclaration(s) || t.isExportDefaultDeclaration(s) || t.isExportAllDeclaration(s)) {
        exports.push(s); expCount++;
      }
      else mid.push(s);
    }
    if (imports.length > 0 || decls.length > 0 || exports.length > 0) {
      blockNode.body = [...imports, ...decls, ...mid, ...exports];
      affected++;
    }
  }

  // Walk ALL block scopes (function bodies, if-else branches, loop bodies, etc.)
  function walk(node) {
    if (!node || typeof node !== "object") return;
    if (t.isBlockStatement(node) || node.type === "Program") processBlock(node);
    for (const key of Object.keys(node)) {
      if (SKIP_KEYS.has(key)) continue;
      const val = node[key];
      if (Array.isArray(val)) { for (const v of val) walk(v); }
      else if (val && typeof val.type === "string") walk(val);
    }
  }
  walk(ast);

  const parts = [`${fnCount}fns`, `${varCount}var`, `${letCount}const/let`];
  if (impCount > 0) parts.push(`${impCount}imports`);
  if (expCount > 0) parts.push(`${expCount}exports`);
  console.log(`  Hoisted ${parts.join(" + ")} in ${affected} scopes`);
}

// ---- sanitizeReservedWords: rename reserved-word identifiers to safe alternatives ----
// Obfuscated code commonly uses reserved words (let, default, if, etc.) as parameter
// and variable names. This works in sloppy-mode parsers but breaks when downstream
// tools re-parse the generated output. This pass runs FIRST to clean identifiers.
function sanitizeReservedWords(ast) {
  const RW = RESERVED;

  // Phase 1: collect every identifier already in use (to avoid collisions)
  const allNames = new Set();
  function scanAll(n) {
    if (!n || typeof n !== "object") return;
    if (t.isIdentifier(n)) allNames.add(n.name);
    for (const k of Object.keys(n)) {
      if (SKIP_KEYS.has(k)) continue;
      const v = n[k];
      if (Array.isArray(v)) { for (const x of v) scanAll(x); }
      else if (v && typeof v.type === "string") scanAll(v);
    }
  }
  scanAll(ast);

  function safeName(name) {
    let c = "_" + name;
    let i = 1;
    while (allNames.has(c)) { c = "_" + name + "_" + i; i++; }
    allNames.add(c);
    return c;
  }

  // Phase 2: find reserved-word identifiers in binding positions
  const map = new Map(); // original → safe

  function collect(n) {
    if (!n || typeof n !== "object") return;
    if (t.isFunction(n)) {
      for (const p of n.params) {
        if (t.isIdentifier(p) && RW.has(p.name) && !map.has(p.name)) map.set(p.name, safeName(p.name));
        else if (t.isAssignmentPattern(p) && t.isIdentifier(p.left) && RW.has(p.left.name) && !map.has(p.left.name)) map.set(p.left.name, safeName(p.left.name));
        else collect(p); // destructured patterns
      }
      if (n.id && t.isIdentifier(n.id) && RW.has(n.id.name) && !map.has(n.id.name)) map.set(n.id.name, safeName(n.id.name));
    }
    if (t.isVariableDeclarator(n) && t.isIdentifier(n.id) && RW.has(n.id.name) && !map.has(n.id.name)) map.set(n.id.name, safeName(n.id.name));
    if (t.isCatchClause(n) && n.param && t.isIdentifier(n.param) && RW.has(n.param.name) && !map.has(n.param.name)) map.set(n.param.name, safeName(n.param.name));
    if (t.isClassDeclaration(n) && n.id && t.isIdentifier(n.id) && RW.has(n.id.name) && !map.has(n.id.name)) map.set(n.id.name, safeName(n.id.name));
    for (const k of Object.keys(n)) {
      if (SKIP_KEYS.has(k)) continue;
      const v = n[k];
      if (Array.isArray(v)) { for (const x of v) collect(x); }
      else if (v && typeof v.type === "string") collect(v);
    }
  }
  collect(ast);

  if (map.size === 0) return;

  // Phase 3: replace all references + fix property keys
  let refCount = 0;
  function replace(n) {
    if (!n || typeof n !== "object") return;
    // Identifier → safe name
    if (t.isIdentifier(n) && map.has(n.name)) { n.name = map.get(n.name); refCount++; return; }
    // obj.reservedWord → obj["reservedWord"]
    if (t.isMemberExpression(n) && !n.computed && t.isIdentifier(n.property) && RW.has(n.property.name) && !map.has(n.property.name)) {
      n.property = t.stringLiteral(n.property.name); n.computed = true;
    }
    // { reservedWord } → { "reservedWord": _reservedWord } (shorthand fix)
    if (t.isObjectProperty(n) && !n.computed && n.shorthand && t.isIdentifier(n.key) && map.has(n.key.name)) {
      n.key = t.stringLiteral(n.key.name); n.shorthand = false;
    }
    // { reservedWord: ... } — key stays as string
    if (t.isObjectProperty(n) && !n.computed && t.isIdentifier(n.key) && RW.has(n.key.name) && !n.shorthand) {
      n.key = t.stringLiteral(n.key.name);
    }
    for (const k of Object.keys(n)) {
      if (SKIP_KEYS.has(k)) continue;
      const v = n[k];
      if (Array.isArray(v)) { for (const x of v) replace(x); }
      else if (v && typeof v.type === "string") replace(v);
    }
  }
  replace(ast);

  console.log(`  Renamed ${map.size} reserved-word identifiers (${refCount} refs updated)`);
}

// ---- annotateAlerts: inject [Label] comments before functions with security-relevant strings ----
function annotateAlerts(ast) {
  let count = 0;

  function walkFn(node) {
    if (!node || typeof node !== "object") return;
    if (t.isFunctionDeclaration(node) && node.id) {
      const matches = [];
      function collectStrings(n) {
        if (!n || typeof n !== "object") return;
        if (t.isStringLiteral(n) && n.value) {
          for (const p of ALERT_PATTERNS) {
            const found = [];
            let m;
            p.regex.lastIndex = 0;
            while ((m = p.regex.exec(n.value)) !== null) found.push(m[0]);
            p.regex.lastIndex = 0;
            if (found.length > 0) {
              const existing = matches.find((a) => a.label === p.label);
              if (existing) { for (const f of found) if (!existing.matches.includes(f)) existing.matches.push(f); }
              else matches.push({ label: p.label, severity: p.severity, matches: [...new Set(found)] });
            }
          }
        }
        if (t.isFunction(n)) return;
        for (const k of Object.keys(n)) {
          if (k === "start" || k === "end" || k === "loc" ||
              k === "leadingComments" || k === "trailingComments" || k === "innerComments") continue;
          const v = n[k];
          if (Array.isArray(v)) { for (const x of v) collectStrings(x); }
          else if (v && typeof v.type === "string") collectStrings(v);
        }
      }
      collectStrings(node.body);
      // AST-based alert detection (not string-based)
      function scanAST(n) {
        if (!n || typeof n !== "object") return;
        // debugger statement
        if (n.type === "DebuggerStatement") {
          const existing = matches.find((a) => a.label === "Anti-Tamper");
          if (existing) { if (!existing.matches.includes("debugger")) existing.matches.push("debugger"); }
          else matches.push({ label: "Anti-Tamper", matches: ["debugger"] });
        }
        // new Function() or eval()
        if (t.isCallExpression(n) || t.isNewExpression(n)) {
          if (t.isIdentifier(n.callee, { name: "eval" })) {
            const existing = matches.find((a) => a.label === "Eval/Dynamic");
            if (existing) { if (!existing.matches.includes("eval()")) existing.matches.push("eval()"); }
            else matches.push({ label: "Eval/Dynamic", matches: ["eval()"] });
          }
          if (t.isIdentifier(n.callee, { name: "Function" })) {
            const existing = matches.find((a) => a.label === "Eval/Dynamic");
            if (existing) { if (!existing.matches.includes("new Function()")) existing.matches.push("new Function()"); }
            else matches.push({ label: "Eval/Dynamic", matches: ["new Function()"] });
          }
        }
        for (const k of Object.keys(n)) {
          if (k === "start" || k === "end" || k === "loc") continue;
          const v = n[k];
          if (Array.isArray(v)) { for (const x of v) scanAST(x); }
          else if (v && typeof v.type === "string") scanAST(v);
        }
      }
      scanAST(node.body);
      if (matches.length > 0) {
        if (!node.leadingComments) node.leadingComments = [];
        const parts = matches.map((a) => `[${a.label}] ${a.matches.join(" · ")}`);
        node.leadingComments.push({ type: "CommentLine", value: " " + parts.join("  ") });
        count++;
      }
    }
    for (const k of Object.keys(node)) {
      if (SKIP_KEYS.has(k)) continue;
      const v = node[k];
      if (Array.isArray(v)) { for (const x of v) walkFn(x); }
      else if (v && typeof v.type === "string") walkFn(v);
    }
  }
  walkFn(ast);

  console.log(`  Annotated ${count} functions with security alerts`);
}

// ---- sortByCallTree: reorder _S_ functions by execution dependency ----
// General: topological sort so callees appear before callers.
function sortByCallTree(ast) {
  // Build adjacency: who calls whom (among _S_ functions)
  const allNames = new Set();

  for (const stmt of ast.program.body) {
    if (t.isFunctionDeclaration(stmt) && stmt.id) {
      allNames.add(stmt.id.name);
    }
  }

  const callSets = new Map(); // callerName -> Set<calleeName>
  function collectEdges(node, enclosingFn) {
    if (!node || typeof node !== "object") return;
    if (t.isCallExpression(node) && t.isIdentifier(node.callee) && allNames.has(node.callee.name) && enclosingFn) {
      if (!callSets.has(enclosingFn)) callSets.set(enclosingFn, new Set());
      callSets.get(enclosingFn).add(node.callee.name);
    }
    for (const k of Object.keys(node)) {
      if (SKIP_KEYS.has(k)) continue;
      const v = node[k];
      if (Array.isArray(v)) { for (const x of v) collectEdges(x, enclosingFn); }
      else if (v && typeof v.type === "string") collectEdges(v, enclosingFn);
    }
  }

  for (const stmt of ast.program.body) {
    if (t.isFunctionDeclaration(stmt) && stmt.id) {
      collectEdges(stmt.body, stmt.id.name);
    }
  }

  // Convert sets to arrays for the rest of the algorithm
  const calls = new Map();
  for (const [k, v] of callSets) calls.set(k, [...v]);

  // Topological sort (Kahn's algorithm)
  const inDegree = new Map();
  for (const name of allNames) inDegree.set(name, 0);
  for (const [, callees] of calls) {
    for (const c of callees) {
      if (inDegree.has(c)) inDegree.set(c, (inDegree.get(c) || 0) + 1);
    }
  }

  // Separate _S_ functions from non-_S_ functions
  const subFns = [];
  const otherFns = [];
  for (const stmt of ast.program.body) {
    if (t.isFunctionDeclaration(stmt) && stmt.id && isSubFn(stmt.id.name)) {
      subFns.push(stmt);
    } else {
      otherFns.push(stmt);
    }
  }

  // Sort _S_ functions: leaves first (inDegree=0), then dependents
  const subFnMap = new Map(subFns.map(f => [f.id.name, f]));
  const queue = subFns.filter(f => (inDegree.get(f.id.name) || 0) === 0);
  const sorted = [];
  const visited = new Set(queue.map(f => f.id.name));

  while (queue.length > 0) {
    const fn = queue.shift();
    sorted.push(fn);
    const callees = calls.get(fn.id.name) || [];
    for (const c of callees) {
      if (inDegree.has(c)) {
        inDegree.set(c, (inDegree.get(c) || 1) - 1);
        if (inDegree.get(c) === 0 && !visited.has(c)) {
          visited.add(c);
          const fnNode = subFnMap.get(c);
          if (fnNode) queue.push(fnNode);
        }
      }
    }
  }

  // Add remaining (circular dependencies or non-_S_)
  for (const fn of subFns) {
    if (!visited.has(fn.id.name)) sorted.push(fn);
  }

  // Rebuild: non-_S_ functions first, then sorted _S_ functions
  ast.program.body = [...otherFns, ...sorted];
  console.log(`  Reordered ${sorted.length} functions by call tree`);
}

module.exports = {
  hoistDeclarations,
  sanitizeReservedWords,
  annotateAlerts,
  sortByCallTree,
};

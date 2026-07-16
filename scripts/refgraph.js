// Shared reference graph builder — built once, reused across passes
// Plan A: top-level declarations only

const { t } = require("./config");
const { SKIP_KEYS } = require("./constants");

/**
 * Build a reference graph from the AST (top-level declarations only).
 * Returns { declarations, fnRefs, varUsedBy, isMutated, referenced }
 *   declarations: Map<varName, { kind, isConst, node }>
 *   fnRefs:       Map<fnName,  Set<varName>> — which top-level vars each function references
 *   varUsedBy:    Map<varName, Set<fnName>>  — which functions reference each var
 *   isMutated:    Set<varName> — vars that are assigned to directly (not property mutation)
 *   referenced:   Set<name> — all identifier names that appear anywhere in the AST
 */
function buildRefGraph(ast) {
  const declarations = new Map(); // varName → { kind, isConst, node }
  const fnRefs = new Map();       // fnName  → Set(varName)
  const varUsedBy = new Map();    // varName → Set(fnName)
  const isMutated = new Set();    // varName (direct assignment: cfg = newVal)
  const referenced = new Set();   // all identifier names used anywhere

  // Phase 1: collect top-level declarations
  for (const stmt of ast.program.body) {
    if (t.isVariableDeclaration(stmt)) {
      for (const decl of stmt.declarations) {
        if (t.isIdentifier(decl.id)) {
          declarations.set(decl.id.name, {
            kind: stmt.kind, // var | let | const
            isConst: stmt.kind === "const",
            node: decl.init || null,
          });
        }
      }
    } else if (t.isFunctionDeclaration(stmt) && stmt.id) {
      declarations.set(stmt.id.name, {
        kind: "function",
        isConst: true,
        node: stmt,
      });
    }
  }

  // Phase 2: detect direct mutations (cfg = newVal, cfg++, delete cfg)
  // Only track top-level declared vars
  function scanMutations(node) {
    if (!node || typeof node !== "object") return;
    // cfg = newVal (direct reassignment, not cfg.prop = val)
    if (t.isAssignmentExpression(node) && t.isIdentifier(node.left) && declarations.has(node.left.name)) {
      isMutated.add(node.left.name);
    }
    // cfg++ / ++cfg
    if (t.isUpdateExpression(node) && t.isIdentifier(node.argument) && declarations.has(node.argument.name)) {
      isMutated.add(node.argument.name);
    }
    // delete cfg
    if (t.isUnaryExpression(node) && node.operator === "delete" && t.isIdentifier(node.argument) && declarations.has(node.argument.name)) {
      isMutated.add(node.argument.name);
    }
    for (const key of Object.keys(node)) {
      if (SKIP_KEYS.has(key)) continue;
      const val = node[key];
      if (Array.isArray(val)) { for (const v of val) scanMutations(v); }
      else if (val && typeof val.type === "string") scanMutations(val);
    }
  }

  // Scan all function bodies for mutations
  for (const stmt of ast.program.body) {
    if (t.isFunctionDeclaration(stmt) && stmt.id) {
      scanMutations(stmt.body);
    }
  }

  // Phase 3: collect per-function external references + global referenced set
  function collectRefs(node, enclosingFn, parent, parentKey) {
    if (!node || typeof node !== "object") return;
    // Identifier reference — skip declaration-site names (function id, variable declarator id)
    if (t.isIdentifier(node)) {
      const isDeclName = (parent && t.isFunctionDeclaration(parent) && parentKey === "id") ||
                         (parent && t.isVariableDeclarator(parent) && parentKey === "id");
      if (!isDeclName) {
        referenced.add(node.name);
      }
      // Track which function references which top-level var (always, including decls)
      if (declarations.has(node.name) && enclosingFn) {
        if (!fnRefs.has(enclosingFn)) fnRefs.set(enclosingFn, new Set());
        fnRefs.get(enclosingFn).add(node.name);
        if (!varUsedBy.has(node.name)) varUsedBy.set(node.name, new Set());
        varUsedBy.get(node.name).add(enclosingFn);
      }
    }
    for (const key of Object.keys(node)) {
      if (SKIP_KEYS.has(key)) continue;
      const val = node[key];
      if (Array.isArray(val)) { for (const v of val) collectRefs(v, enclosingFn, node, key); }
      else if (val && typeof val.type === "string") collectRefs(val, enclosingFn, node, key);
    }
  }

  for (const stmt of ast.program.body) {
    if (t.isFunctionDeclaration(stmt) && stmt.id) {
      collectRefs(stmt.body, stmt.id.name);
    } else {
      // Top-level code (not inside any function)
      collectRefs(stmt, null);
    }
  }

  return { declarations, fnRefs, varUsedBy, isMutated, referenced };
}

module.exports = { buildRefGraph };

const { t } = require("./config");

// ---- Generic AST walker ----
// Used by ALL passes: walks entire tree, stops at function boundaries.
function walkAST(node, visitor, state) {
  if (!node || typeof node !== "object") return;
  if (t.isFunction(node)) return;
  visitor(node, state);
  for (const key of Object.keys(node)) {
    if (key === "start" || key === "end" || key === "loc" ||
        key === "leadingComments" || key === "trailingComments" || key === "innerComments") continue;
    const val = node[key];
    if (Array.isArray(val)) { for (const v of val) walkAST(v, visitor, state); }
    else if (val && typeof val.type === "string") walkAST(val, visitor, state);
  }
}

// Walk into function bodies too (for passes that need it)
function walkASTDeep(node, visitor, state) {
  if (!node || typeof node !== "object") return;
  visitor(node, state);
  for (const key of Object.keys(node)) {
    if (key === "start" || key === "end" || key === "loc" ||
        key === "leadingComments" || key === "trailingComments" || key === "innerComments") continue;
    const val = node[key];
    if (Array.isArray(val)) { for (const v of val) walkASTDeep(v, visitor, state); }
    else if (val && typeof val.type === "string") walkASTDeep(val, visitor, state);
  }
}

// Walk statement lists (block bodies / program body), stopping at function boundaries
function walkStmtLists(node, visitor) {
  if (!node || typeof node !== "object") return;
  if (t.isFunction(node)) return;
  if ((t.isBlockStatement(node) || node.type === "Program") && Array.isArray(node.body)) {
    visitor(node.body);
  }
  for (const key of Object.keys(node)) {
    if (key === "start" || key === "end" || key === "loc" ||
        key === "leadingComments" || key === "trailingComments" || key === "innerComments") continue;
    const val = node[key];
    if (Array.isArray(val)) { for (const v of val) walkStmtLists(v, visitor); }
    else if (val && typeof val.type === "string") walkStmtLists(val, visitor);
  }
}

// ---- Generic node-type checker ----
function containsNodeType(node, typeNames) {
  const types = Array.isArray(typeNames) ? typeNames : [typeNames];
  let found = false;
  walkAST(node, (n) => { if (types.includes(n.type)) found = true; });
  return found;
}

function containsNodeTypeDeep(node, typeNames) {
  const types = Array.isArray(typeNames) ? typeNames : [typeNames];
  let found = false;
  walkASTDeep(node, (n) => { if (types.includes(n.type)) found = true; });
  return found;
}

// ---- Pattern detection helpers ----
function isIIFE(node) {
  return t.isCallExpression(node) &&
    (t.isFunctionExpression(node.callee) || t.isArrowFunctionExpression(node.callee));
}

function describeBody(stmts) {
  if (!stmts || stmts.length === 0) return "empty";
  if (stmts.length === 1) {
    const s = stmts[0];
    if (t.isReturnStatement(s)) return "return_val";
    if (t.isIfStatement(s)) return "branch";
    if (t.isTryStatement(s)) return "safe";
    if (t.isForStatement(s) || t.isWhileStatement(s)) return "loop";
    if (t.isExpressionStatement(s)) {
      if (t.isCallExpression(s.expression) && t.isMemberExpression(s.expression.callee)) return "method_call";
      if (t.isCallExpression(s.expression)) return "call";
      if (t.isAssignmentExpression(s.expression)) return "assign";
    }
  }
  return "block";
}

function descIIFE(stmts) {
  if (stmts.length === 0) return "empty";
  for (const s of stmts) {
    if (t.isForStatement(s) || t.isWhileStatement(s)) return "loop_body";
    if (t.isTryStatement(s)) return "try_block";
    if (t.isVariableDeclaration(s) && s.declarations.length > 5) return "init_vars";
    if (t.isFunctionDeclaration(s)) return "declare_fn";
  }
  if (stmts.length <= 2) return "inline";
  return "iife_body";
}

// ---- Clone ----
function clone(n) {
  if (!n || typeof n !== "object") return n;
  // Fast-path: simple literals (avoid full object copy for ~45K inline-props calls)
  if (t.isNumericLiteral(n)) return t.numericLiteral(n.value);
  if (t.isStringLiteral(n)) return t.stringLiteral(n.value);
  if (t.isBooleanLiteral(n)) return t.booleanLiteral(n.value);
  if (t.isIdentifier(n) && n.name === "undefined") return t.identifier("undefined");

  const copy = {};
  for (const key of Object.keys(n)) {
    if (key === "start" || key === "end" || key === "loc") continue;
    const val = n[key];
    if (Array.isArray(val)) { copy[key] = val.map((v) => clone(v)); }
    else if (val && typeof val.type === "string") { copy[key] = clone(val); }
    else { copy[key] = val; }
  }
  return copy;
}

// ---- Semantic bail-out detectors (delegated to containsNodeType) ----
const hasSuperCall = (node) => containsNodeType(node, "Super");
const hasBail = (node) => containsNodeType(node, ["BreakStatement", "ContinueStatement"]);
const hasReturn = (node) => containsNodeType(node, "ReturnStatement");
const containsAwait = (node) => containsNodeType(node, "AwaitExpression");

module.exports = {
  walkAST, walkASTDeep, walkStmtLists,
  containsNodeType, containsNodeTypeDeep,
  isIIFE, describeBody, descIIFE, clone,
  hasSuperCall, hasBail, hasReturn, containsAwait,
};

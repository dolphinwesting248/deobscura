const { t } = require("./config");
const { GLOBALS } = require("./constants");

// Collect all names defined in a set of statements (var/let/const/function/params/catch/destructuring)
function collectDefined(stmts) {
  const names = new Set();
  for (const s of stmts) {
    if (t.isVariableDeclaration(s)) { for (const d of s.declarations) collectBindingNames(d.id, names); }
    if (t.isFunctionDeclaration(s) && s.id) names.add(s.id.name);
    if (t.isFunctionDeclaration(s)) { for (const p of s.params) collectBindingNames(p, names); }
    if (t.isForStatement(s) && s.init && t.isVariableDeclaration(s.init)) { for (const d of s.init.declarations) collectBindingNames(d.id, names); }
    if (t.isTryStatement(s) && s.handler && s.handler.param) collectBindingNames(s.handler.param, names);
  }
  return names;
}

function collectBindingNames(pattern, names) {
  if (t.isIdentifier(pattern)) { names.add(pattern.name); }
  else if (t.isObjectPattern(pattern)) { for (const prop of pattern.properties) { if (t.isRestElement(prop)) collectBindingNames(prop.argument, names); else collectBindingNames(prop.value, names); } }
  else if (t.isArrayPattern(pattern)) { for (const elem of pattern.elements) { if (elem) collectBindingNames(elem, names); } }
  else if (t.isAssignmentPattern(pattern)) { collectBindingNames(pattern.left, names); }
  else if (t.isRestElement(pattern)) { collectBindingNames(pattern.argument, names); }
}

// Collect all external identifier references (used but not defined in the block)
function collectRefsImpl(node, defined, collected) {
  if (!node || typeof node !== "object" || node.$$refW) return;
  node.$$refW = true;
  if (t.isIdentifier(node) && !defined.has(node.name) && !GLOBALS.has(node.name)) { collected.add(node.name); return; }
  if (t.isFunction(node)) return;
  for (const key of Object.keys(node)) {
    if (key === "start" || key === "end" || key === "loc" || key === "$$refW" ||
        key === "leadingComments" || key === "trailingComments" || key === "innerComments") continue;
    const val = node[key];
    if (Array.isArray(val)) { for (const v of val) collectRefsImpl(v, defined, collected); }
    else if (val && typeof val.type === "string") collectRefsImpl(val, defined, collected);
  }
}

function getExternalRefs(node, defined) {
  const collected = new Set();
  collectRefsImpl(node, defined, collected);
  clearRefWalked(node);
  return [...collected];
}

function clearRefWalked(node) {
  if (!node || typeof node !== "object" || !node.$$refW) return;
  node.$$refW = false;
  for (const key of Object.keys(node)) {
    if (key === "start" || key === "end" || key === "loc" || key === "$$refW" ||
        key === "leadingComments" || key === "trailingComments" || key === "innerComments") continue;
    const val = node[key];
    if (Array.isArray(val)) { for (const v of val) clearRefWalked(v); }
    else if (val && typeof val.type === "string") clearRefWalked(val);
  }
}

module.exports = { collectDefined, collectBindingNames, getExternalRefs };

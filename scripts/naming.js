const { t } = require("./config");

const usedNames = new Set();

function cleanName(name) {
  let cleaned = name.replace(/^_S_/, "").replace(/^_+/, "");
  if (cleaned.length > 40) cleaned = cleaned.slice(-40);
  return cleaned;
}

function subName(parentName, seq, hint, sourceNode) {
  const s = String(seq).padStart(2, "0");
  let clean = cleanName(parentName);
  let base = `_S_${clean}_${s}_${hint || "fn"}`;
  if (!usedNames.has(base)) { usedNames.add(base); return base; }
  // Collision: add source line number for disambiguation
  if (sourceNode && sourceNode.loc) {
    const withLine = `_S_${clean}_L${sourceNode.loc.start.line}_${s}_${hint || "fn"}`;
    if (!usedNames.has(withLine)) { usedNames.add(withLine); return withLine; }
  }
  let i = 2;
  while (usedNames.has(base + "_" + i)) i++;
  const name = base + "_" + i;
  usedNames.add(name);
  return name;
}

function resetNames() { usedNames.clear(); }

function getFnName(node) {
  if (!node) return "anon";
  if (t.isFunctionDeclaration(node) && node.id) return node.id.name;
  if (t.isFunctionExpression(node) && node.id) return node.id.name;
  if ((t.isObjectMethod(node) || t.isClassMethod(node) || t.isClassPrivateMethod(node)) && node.key) {
    if (t.isIdentifier(node.key)) return node.key.name;
    if (t.isStringLiteral(node.key)) return node.key.value;
    if (node.key.loc) return `l${node.key.loc.start.line}`;
  }
  if (node.loc) return `l${node.loc.start.line}`;
  return "anon";
}

module.exports = { cleanName, subName, getFnName, resetNames };

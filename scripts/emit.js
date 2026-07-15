const { t } = require("./config");
const { containsAwait, containsYield, containsForAwait } = require("./ast-utils");

// ---- Line-range comment on extracted sub-functions ----
function addLineComment(fnNode, sourceNode) {
  if (!sourceNode || !sourceNode.loc) return;
  const { start, end } = sourceNode.loc;
  if (!fnNode.leadingComments) fnNode.leadingComments = [];
  fnNode.leadingComments.push({ type: "CommentLine", value: ` Original lines ${start.line}-${end.line} ` });
}

// ---- Reserved words that cannot be parameter names ----
const RESERVED = new Set([
  "break", "case", "catch", "continue", "debugger", "default", "delete",
  "do", "else", "finally", "for", "function", "if", "in", "instanceof",
  "new", "return", "switch", "this", "throw", "try", "typeof", "var",
  "void", "while", "with", "class", "const", "enum", "export", "extends",
  "import", "super", "implements", "interface", "let", "package",
  "private", "protected", "public", "static", "yield", "await", "async",
]);

function safeParam(name) {
  return RESERVED.has(name) ? name + "_" : name;
}

// ---- Create a sub-function declaration with proper async flag ----
function createSubFn(name, params, body, sourceNode) {
  // Sanitize reserved-word parameter names
  const safeParams = params.map((p) => {
    if (t.isIdentifier(p) && RESERVED.has(p.name)) {
      return t.identifier(p.name + "_");
    }
    return p;
  });

  const fn = t.functionDeclaration(
    t.identifier(name),
    safeParams,
    t.isBlockStatement(body) ? body : t.blockStatement(body),
  );
  if (containsAwait(fn.body) || containsForAwait(fn.body)) fn.async = true;
  if (containsYield(fn.body)) fn.generator = true;
  addLineComment(fn, sourceNode);
  return fn;
}

module.exports = { addLineComment, createSubFn, safeParam };

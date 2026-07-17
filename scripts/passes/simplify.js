// Simplify passes: constant folding, boolean simplification, normalization

const { t } = require("../config");
const { SKIP_KEYS, THRESHOLDS } = require("../constants");
const { clone } = require("../ast-utils");

// ---- simplify: combined fold+boolean+strings+ast-normalize in ONE walk ----
function simplify(ast) {
  let foldCount = 0, boolCount = 0, strCount = 0, normCount = 0;

  function isFoldable(node) {
    if (!node) return false;
    if (t.isNumericLiteral(node) || t.isStringLiteral(node) || t.isBooleanLiteral(node)) return true;
    if (t.isUnaryExpression(node) && isFoldable(node.argument)) return true;
    if (t.isBinaryExpression(node) && isFoldable(node.left) && isFoldable(node.right)) return true;
    return false;
  }
  function evalConst(node) {
    if (t.isNumericLiteral(node)) return node.value;
    if (t.isStringLiteral(node)) return node.value;
    if (t.isBooleanLiteral(node)) return node.value;
    if (t.isUnaryExpression(node)) {
      const a = evalConst(node.argument); if (a === undefined) return undefined;
      switch (node.operator) {
        case "-": return -a; case "+": return +a; case "!": return !a;
        case "~": return ~a; case "void": return undefined; case "typeof": return typeof a;
      }
    }
    if (t.isBinaryExpression(node)) {
      const l = evalConst(node.left), r = evalConst(node.right);
      if (l === undefined || r === undefined) return undefined;
      switch (node.operator) {
        case "+": return l+r; case "-": return l-r; case "*": return l*r;
        case "/": return r===0?undefined:l/r; case "%": return r===0?undefined:l%r; case "**": return l**r;
        case "|": return l|r; case "&": return l&r; case "^": return l^r;
        case "<<": return l<<r; case ">>": return l>>r; case ">>>": return l>>>r;
        case "==": return l==r; case "!=": return l!=r; case "===": return l===r; case "!==": return l!==r;
        case "<": return l<r; case ">": return l>r; case "<=": return l<=r; case ">=": return l>=r;
      }
    }
    return undefined;
  }
  function litResult(v) {
    if (typeof v === "string") return t.stringLiteral(v);
    if (typeof v === "boolean") return t.booleanLiteral(v);
    if (typeof v === "number") {
      if (Number.isNaN(v)) return t.identifier("NaN");
      if (!Number.isFinite(v)) return v>0?t.identifier("Infinity"):t.binaryExpression("-", t.identifier("Infinity"));
      return t.numericLiteral(v);
    }
    return t.identifier("undefined");
  }

  function walk(node) {
    if (!node || typeof node !== "object") return node;

    // --- boolean: !![]→true, ![]→false, void 0→undefined ---
    if (t.isUnaryExpression(node) && node.operator === "!" &&
        t.isUnaryExpression(node.argument) && node.argument.operator === "!" &&
        t.isArrayExpression(node.argument.argument) && node.argument.argument.elements.length === 0)
      { boolCount++; return t.booleanLiteral(true); }
    if (t.isUnaryExpression(node) && node.operator === "!" &&
        t.isArrayExpression(node.argument) && node.argument.elements.length === 0)
      { boolCount++; return t.booleanLiteral(false); }
    if (t.isUnaryExpression(node) && node.operator === "void" &&
        t.isNumericLiteral(node.argument) && node.argument.value === 0)
      { boolCount++; return t.identifier("undefined"); }

    // --- fold: constant expressions ---
    if (t.isBinaryExpression(node) && isFoldable(node.left) && isFoldable(node.right)) {
      const v = evalConst(node);
      if (v !== undefined) { foldCount++; return litResult(v); }
    }
    if (t.isUnaryExpression(node) && isFoldable(node.argument)) {
      const v = evalConst(node);
      if (v !== undefined) {
        foldCount++;
        if (typeof v === "boolean") return t.booleanLiteral(v);
        if (typeof v === "number") return t.numericLiteral(v);
        if (typeof v === "undefined" || v === undefined) return t.identifier("undefined");
      }
    }

    // --- strings: String.fromCharCode etc ---
    if (t.isCallExpression(node) &&
        t.isMemberExpression(node.callee) && t.isIdentifier(node.callee.object, { name: "String" }) &&
        t.isIdentifier(node.callee.property, { name: "fromCharCode" }) &&
        node.arguments.every((a) => t.isNumericLiteral(a)))
      { strCount++; return t.stringLiteral(String.fromCharCode(...node.arguments.map((a) => a.value))); }
    if (t.isCallExpression(node) && t.isMemberExpression(node.callee) &&
        t.isStringLiteral(node.callee.object) && node.arguments.every((a) => t.isNumericLiteral(a)) &&
        node.callee.property && t.isIdentifier(node.callee.property)) {
      const method = node.callee.property.name;
      const obj = node.callee.object.value;
      const args = node.arguments.map((a) => a.value);
      if (method === "charAt" && args.length === 1) { strCount++; return t.stringLiteral(obj.charAt(args[0])); }
      if (method === "charCodeAt" && args.length === 1) { strCount++; return t.numericLiteral(obj.charCodeAt(args[0])); }
      if ((method === "slice" || method === "substr" || method === "substring") && args.length >= 1 && args.length <= 2) { strCount++; return t.stringLiteral(obj[method](args[0], args[1])); }
      if ((method === "toUpperCase" || method === "toLowerCase" || method === "trim" || method === "trimStart" || method === "trimEnd") && args.length === 0) { strCount++; return t.stringLiteral(obj[method]()); }
      if ((method === "indexOf" || method === "lastIndexOf") && args.length === 1 && t.isStringLiteral(node.arguments[0])) { strCount++; return t.numericLiteral(obj[method](node.arguments[0].value)); }
    }

    // --- string concat: "a" + "b" → "ab" ---
    if (t.isBinaryExpression(node) && node.operator === "+" &&
        t.isStringLiteral(node.left) && t.isStringLiteral(node.right))
      { strCount++; return t.stringLiteral(node.left.value + node.right.value); }

    // --- array join: ["a","b"].join("") → "ab" ---
    if (t.isCallExpression(node) && t.isMemberExpression(node.callee) &&
        t.isIdentifier(node.callee.property, { name: "join" }) &&
        t.isArrayExpression(node.callee.object) &&
        node.callee.object.elements.every((e) => t.isStringLiteral(e)) &&
        node.arguments.length <= 1 &&
        (!node.arguments[0] || t.isStringLiteral(node.arguments[0]))) {
      const sep = (node.arguments[0] && node.arguments[0].value) || ",";
      strCount++;
      return t.stringLiteral(node.callee.object.elements.map((e) => e.value).join(sep));
    }

    // --- string concat: "".concat(a, b) → when all literals, compute result ---
    if (t.isCallExpression(node) && t.isMemberExpression(node.callee) &&
        t.isIdentifier(node.callee.property, { name: "concat" }) &&
        t.isStringLiteral(node.callee.object) &&
        node.arguments.every((a) => t.isStringLiteral(a))) {
      const parts = [node.callee.object.value, ...node.arguments.map((a) => a.value)];
      strCount++;
      return t.stringLiteral(parts.join(""));
    }

    // --- hex/unicode string normalization: extra.raw still has \x escapes after Babel decoding ---
    if (t.isStringLiteral(node) && node.extra && node.extra.raw && /\\x[0-9a-f]{2}|\\u[0-9a-f]{4}/i.test(node.extra.raw)) {
      strCount++;
      node.extra = { rawValue: node.value, raw: JSON.stringify(node.value) };
    }

    // --- hex numeric normalization: 0xa4 → 164 (only for small values used as indices/char codes) ---
    if (t.isNumericLiteral(node) && node.extra && node.extra.rawValue && /^0x[0-9a-f]+$/i.test(node.extra.rawValue)) {
      const val = node.value;
      // Only normalize small hex values that are likely indices/char codes, not memory addresses
      if (val < THRESHOLDS.HEX_NORM_MAX) {
        normCount++;
        node.extra = { rawValue: val, raw: String(val) };
      }
    }

    // --- normalize (AST-level): ~arr.indexOf→arr.includes, ~~x→Math.trunc, +x→Number ---
    if (t.isUnaryExpression(node) && node.operator === "~" &&
        t.isCallExpression(node.argument) && t.isMemberExpression(node.argument.callee) &&
        t.isIdentifier(node.argument.callee.property, { name: "indexOf" }))
      { normCount++; return t.callExpression(t.memberExpression(node.argument.callee.object, t.identifier("includes")), node.argument.arguments); }
    if (t.isUnaryExpression(node) && node.operator === "~" &&
        t.isUnaryExpression(node.argument) && node.argument.operator === "~")
      { normCount++; return t.callExpression(t.memberExpression(t.identifier("Math"), t.identifier("trunc")), [node.argument.argument]); }
    if (t.isUnaryExpression(node) && node.operator === "+" && !t.isNumericLiteral(node.argument) && t.isIdentifier(node.argument))
      { normCount++; return t.callExpression(t.identifier("Number"), [node.argument]); }

    // Recurse
    for (const key of Object.keys(node)) {
      if (SKIP_KEYS.has(key)) continue;
      const val = node[key];
      if (Array.isArray(val)) {
        for (let i = 0; i < val.length; i++) {
          if (val[i] && typeof val[i].type === "string") val[i] = walk(val[i]);
        }
      } else if (val && typeof val.type === "string") {
        node[key] = walk(val);
      }
    }
    return node;
  }

  walk(ast);
  // Second pass for cascading folds
  walk(ast);
  console.log(`  Fold:${foldCount} Bool:${boolCount} Str:${strCount} Norm:${normCount}`);
}

// ---- normalizeShortCircuit: convert logical | / && at statement level into if blocks ----
// Handles polyfill patterns:  A || B || (u=[], fn1=..., fn2=...)  →  if (!A && !B) { u=[]; fn1=...; fn2=...; }
// And conditional chains:    A && (x(), y())                        →  if (A) { x(); y(); }
function normalizeShortCircuit(ast) {
  let count = 0;

  function collectChain(node, op) {
    const operands = [];
    let cur = node;
    while (t.isLogicalExpression(cur) && cur.operator === op) {
      operands.unshift(cur.right);
      cur = cur.left;
    }
    operands.unshift(cur);
    return operands;
  }

  function toStmts(expr) {
    if (t.isSequenceExpression(expr)) {
      return expr.expressions.map((e) => t.expressionStatement(e));
    }
    return [t.expressionStatement(expr)];
  }

  function expand(node) {
    // Unwrap parentheses wrapping the logical expression
    if (t.isParenthesizedExpression(node)) node = node.expression;
    if (!t.isLogicalExpression(node)) return [t.expressionStatement(node)];

    const op = node.operator;
    const operands = collectChain(node, op);
    const bodyExpr = operands.pop();
    const conditions = operands;

    let test;
    if (op === "||") {
      // A || B || C  →  if (!A && !B) { C }
      const negated = conditions.map((c) => t.unaryExpression("!", c));
      test = negated.length === 1 ? negated[0] : negated.reduce((a, b) => t.logicalExpression("&&", a, b));
    } else {
      // A && B && C  →  if (A && B) { C }
      test = conditions.length === 1 ? conditions[0] : conditions.reduce((a, b) => t.logicalExpression("&&", a, b));
    }

    const bodyStmts = expand(bodyExpr);
    count++;
    return [t.ifStatement(test, t.blockStatement(bodyStmts))];
  }

  function walkStmts(stmtArray) {
    for (let i = 0; i < stmtArray.length; i++) {
      const stmt = stmtArray[i];

      // ExpressionStatement: logical / ternary
      if (t.isExpressionStatement(stmt)) {
        let expr = stmt.expression;
        if (t.isParenthesizedExpression(expr)) expr = expr.expression;
        if (t.isLogicalExpression(expr)) {
          const expanded = expand(expr);
          stmtArray.splice(i, 1, ...expanded);
          i += expanded.length - 1;
        } else if (t.isConditionalExpression(expr)) {
          stmtArray.splice(i, 1, t.ifStatement(
            expr.test,
            t.blockStatement(toStmts(expr.consequent)),
            t.blockStatement(toStmts(expr.alternate))
          ));
          count++;
        }
      }

      // VariableDeclaration with ternary init: var x = cond ? a : b
      // → var x; if (cond) { x = a; } else { x = b; }
      if (t.isVariableDeclaration(stmt) && stmt.kind !== "const") {
        const splits = [];
        for (let d = 0; d < stmt.declarations.length; d++) {
          const decl = stmt.declarations[d];
          if (decl.init && t.isConditionalExpression(decl.init) && t.isIdentifier(decl.id)) {
            const ce = decl.init;
            splits.push({
              name: decl.id.name,
              ifStmt: t.ifStatement(
                ce.test,
                t.blockStatement([t.expressionStatement(
                  t.assignmentExpression("=", t.identifier(decl.id.name), ce.consequent)
                )]),
                t.blockStatement([t.expressionStatement(
                  t.assignmentExpression("=", t.identifier(decl.id.name), ce.alternate)
                )])
              ),
            });
            decl.init = null; // remove init, keep declaration
            count++;
          }
        }
        if (splits.length > 0) {
          stmtArray.splice(i + 1, 0, ...splits.map((s) => s.ifStmt));
          i += splits.length;
        }
      }
    }
  }

  function walk(node) {
    if (!node || typeof node !== "object") return;
    if ((t.isBlockStatement(node) || node.type === "Program") && Array.isArray(node.body)) {
      walkStmts(node.body);
    }
    // Walk into children — including function bodies and class methods
    if (t.isFunction(node)) {
      if (node.body) walk(node.body);
      return;
    }
    for (const k of Object.keys(node)) {
      if (SKIP_KEYS.has(k)) continue;
      const v = node[k];
      if (Array.isArray(v)) {
        for (let i = 0; i < v.length; i++) walk(v[i]);
      } else if (v && typeof v.type === "string") {
        // Check for single-statement bodies (for/while/if w/o braces)
        if (t.isExpressionStatement(v)) {
          let expr = v.expression;
          if (t.isParenthesizedExpression(expr)) expr = expr.expression;
          if (t.isLogicalExpression(expr)) {
            const expanded = expand(expr);
            node[k] = expanded.length === 1 ? expanded[0] : t.blockStatement(expanded);
            count++;
            walk(node[k]);
            continue;
          }
          if (t.isConditionalExpression(expr)) {
            node[k] = t.ifStatement(expr.test,
              t.blockStatement(toStmts(expr.consequent)),
              t.blockStatement(toStmts(expr.alternate)));
            count++;
            walk(node[k]);
            continue;
          }
        }
        // var x = cond ? a : b  inside single-statement body
        // Skip for-loop init — can't replace with BlockStatement
        if (t.isVariableDeclaration(v) && v.kind !== "const" &&
            !(k === "init" && (t.isForStatement(node) || t.isForInStatement(node) || t.isForOfStatement(node)))) {
          const splits = [];
          for (let d = 0; d < v.declarations.length; d++) {
            const decl = v.declarations[d];
            if (decl.init && t.isConditionalExpression(decl.init) && t.isIdentifier(decl.id)) {
              const ce = decl.init;
              splits.push(t.ifStatement(ce.test,
                t.blockStatement([t.expressionStatement(
                  t.assignmentExpression("=", t.identifier(decl.id.name), ce.consequent)
                )]),
                t.blockStatement([t.expressionStatement(
                  t.assignmentExpression("=", t.identifier(decl.id.name), ce.alternate)
                )])
              ));
              decl.init = null;
              count++;
            }
          }
          if (splits.length > 0) {
            node[k] = t.blockStatement([v, ...splits]);
            walk(node[k]);
            continue;
          }
        }
        walk(v);
      }
    }
  }
  walk(ast);

  if (count > 0) console.log(`  Converted ${count} logical expressions to if blocks`);
  return count;
}

// ---- expandSequences: break comma chains into independent statements ----
function expandSequences(ast) {
  let count = 0;

  // Collect replacements first, apply after walk
  const replacements = []; // { parent: array, index, newNodes: [] }

  function collectExpansions(node, parentArray, stmtIndex) {
    if (!node || typeof node !== "object") return;

    // ExpressionStatement with SequenceExpression
    if (t.isExpressionStatement(node) && t.isSequenceExpression(node.expression)) {
      const exprs = node.expression.expressions;
      const newStmts = [];
      // All but last become expression statements
      for (let i = 0; i < exprs.length - 1; i++) {
        newStmts.push(t.expressionStatement(exprs[i]));
      }
      // Last replaces current statement
      newStmts.push(t.expressionStatement(exprs[exprs.length - 1]));
      if (parentArray) { replacements.push({ array: parentArray, index: stmtIndex, stmts: newStmts }); }
      count += exprs.length - 1;
    }

    // ReturnStatement with sequence: return (a, b)
    if (t.isReturnStatement(node) && node.argument && t.isSequenceExpression(node.argument)) {
      const seq = node.argument;
      const exprs = seq.expressions;
      const newStmts = [];
      for (let i = 0; i < exprs.length - 1; i++) {
        newStmts.push(t.expressionStatement(exprs[i]));
      }
      newStmts.push(t.returnStatement(exprs[exprs.length - 1]));
      if (parentArray) { replacements.push({ array: parentArray, index: stmtIndex, stmts: newStmts }); }
      count += exprs.length - 1;
    }

    // VariableDeclaration init with sequence: var x = (a, b)
    if (t.isVariableDeclaration(node)) {
      for (const decl of node.declarations) {
        if (decl.init && t.isSequenceExpression(decl.init)) {
          const seq = decl.init;
          const exprs = seq.expressions;
          const newStmts = [];
          for (let i = 0; i < exprs.length - 1; i++) {
            newStmts.push(t.expressionStatement(exprs[i]));
          }
          decl.init = exprs[exprs.length - 1];
          newStmts.push(node);
          if (parentArray) { replacements.push({ array: parentArray, index: stmtIndex, stmts: newStmts }); }
          count += exprs.length - 1;
          break; // already handled this VariableDeclaration
        }
      }
    }

    // Don't recurse into functions or blocks (walkStmtLists handles them)
    if (t.isFunction(node) || t.isBlockStatement(node)) return;

    // Recurse into children
    for (const key of Object.keys(node)) {
      if (SKIP_KEYS.has(key)) continue;
      const val = node[key];
      if (Array.isArray(val)) {
        for (let i = 0; i < val.length; i++) {
          if (val[i] && typeof val[i].type === "string") collectExpansions(val[i], val, i);
        }
      } else if (val && typeof val.type === "string") {
        collectExpansions(val, null, -1);
      }
    }
  }

  // Walk all statement lists through the AST
  function walkStmtLists(node) {
    if (!node || typeof node !== "object") return;

    // Walk block and program statement arrays
    if ((t.isBlockStatement(node) || node.type === "Program") && Array.isArray(node.body)) {
      collectExpansionsIn(node.body);
    }
    // Walk into function bodies (but not the body's bodies — recurse handles that)
    if (t.isFunction(node)) {
      if (node.body) walkStmtLists(node.body);
      return;
    }

    for (const key of Object.keys(node)) {
      if (SKIP_KEYS.has(key)) continue;
      const val = node[key];
      if (Array.isArray(val)) { for (const v of val) walkStmtLists(v); }
      else if (val && typeof val.type === "string") walkStmtLists(val);
    }
  }

  function collectExpansionsIn(stmtArray) {
    for (let i = 0; i < stmtArray.length; i++) {
      collectExpansions(stmtArray[i], stmtArray, i);
    }
  }

  // First collect all expansions
  walkStmtLists(ast);

  // Apply in reverse order (to preserve indices)
  for (const { array, index, stmts } of replacements.reverse()) {
    array.splice(index, 1, ...stmts);
  }

  console.log(`  Expanded ${count} sequence expressions`);
}

// ---- simplifyRedundantConditions: clean up patterns from previous passes ----
// Pattern recognition instead of deep evaluation — safe and general.
function simplifyRedundantConditions(ast) {
  let count = 0;

  const replacements = [];

  function collectIn(stmtArray) {
    for (let i = 0; i < stmtArray.length; i++) {
      const s = stmtArray[i];

      // ---- Pattern: if (a) return true; return false; → return !!a ----
      if (t.isIfStatement(s) && t.isReturnStatement(s.consequent) && s.consequent.argument &&
          t.isBooleanLiteral(s.consequent.argument, { value: true }) && s.alternate === null &&
          i + 1 < stmtArray.length && t.isReturnStatement(stmtArray[i + 1]) && stmtArray[i + 1].argument &&
          t.isBooleanLiteral(stmtArray[i + 1].argument, { value: false })) {
        count++;
        const replacement = t.returnStatement(
          t.unaryExpression("!", t.unaryExpression("!", clone(s.test))),
        );
        replacements.push({ array: stmtArray, index: i, count: 2, stmts: [replacement] });
      }

      // ---- Pattern: if (a) return false; return true; → return !a ----
      if (t.isIfStatement(s) && t.isReturnStatement(s.consequent) && s.consequent.argument &&
          t.isBooleanLiteral(s.consequent.argument, { value: false }) && s.alternate === null &&
          i + 1 < stmtArray.length && t.isReturnStatement(stmtArray[i + 1]) && stmtArray[i + 1].argument &&
          t.isBooleanLiteral(stmtArray[i + 1].argument, { value: true })) {
        count++;
        const replacement = t.returnStatement(
          t.unaryExpression("!", clone(s.test)),
        );
        replacements.push({ array: stmtArray, index: i, count: 2, stmts: [replacement] });
      }

      // ---- Pattern: if (X !== X) { ... } → dead branch, remove entirely ----
      // Obfuscator injects self-comparison checks that are always false
      if (t.isIfStatement(s) && s.test &&
          t.isBinaryExpression(s.test) && (s.test.operator === "!==" || s.test.operator === "!=") &&
          t.isIdentifier(s.test.left) && t.isIdentifier(s.test.right) &&
          s.test.left.name === s.test.right.name) {
        count++;
        if (s.alternate) {
          replacements.push({ array: stmtArray, index: i, count: 1, stmts: [t.isBlockStatement(s.alternate) ? s.alternate : t.blockStatement([s.alternate])] });
        } else {
          replacements.push({ array: stmtArray, index: i, count: 1, stmts: [] });
        }
      }
      // ---- Pattern: if (X === X) { ... } → always true, keep consequent, drop alternate ----
      if (t.isIfStatement(s) && s.test &&
          t.isBinaryExpression(s.test) && (s.test.operator === "===" || s.test.operator === "==") &&
          t.isIdentifier(s.test.left) && t.isIdentifier(s.test.right) &&
          s.test.left.name === s.test.right.name) {
        count++;
        const consequent = t.isBlockStatement(s.consequent) ? s.consequent.body : [s.consequent];
        replacements.push({ array: stmtArray, index: i, count: 1, stmts: consequent });
      }
    }
  }

  function walkLists(node) {
    if (!node || typeof node !== "object") return;
    if ((t.isBlockStatement(node) || node.type === "Program") && Array.isArray(node.body)) {
      collectIn(node.body);
    }
    for (const key of Object.keys(node)) {
      if (SKIP_KEYS.has(key)) continue;
      const val = node[key];
      if (Array.isArray(val)) { for (const v of val) walkLists(v); }
      else if (val && typeof val.type === "string") walkLists(val);
    }
  }

  walkLists(ast);
  replacements.reverse().forEach(({ array, index, count: n, stmts }) => array.splice(index, n, ...stmts));

  // ---- Second pass: AST-walk simplifications ----
  function walk(node) {
    if (!node || typeof node !== "object") return node;

    // a ? true : false → !!a
    if (t.isConditionalExpression(node) &&
        t.isBooleanLiteral(node.consequent, { value: true }) &&
        t.isBooleanLiteral(node.alternate, { value: false })) {
      count++;
      return t.unaryExpression("!", t.unaryExpression("!", walk(node.test)));
    }

    // a ? false : true → !a
    if (t.isConditionalExpression(node) &&
        t.isBooleanLiteral(node.consequent, { value: false }) &&
        t.isBooleanLiteral(node.alternate, { value: true })) {
      count++;
      return t.unaryExpression("!", walk(node.test));
    }

    // !!a → a  (skip triple+ negation to not interfere with !!!a → !a above)
    if (t.isUnaryExpression(node) && node.operator === "!" &&
        t.isUnaryExpression(node.argument) && node.argument.operator === "!" &&
        !(t.isUnaryExpression(node.argument.argument) && node.argument.argument.operator === "!")) {
      count++;
      return walk(node.argument.argument);
    }

    // !!!a → !a
    if (t.isUnaryExpression(node) && node.operator === "!" &&
        t.isUnaryExpression(node.argument) && node.argument.operator === "!" &&
        t.isUnaryExpression(node.argument.argument) && node.argument.argument.operator === "!") {
      count++;
      return t.unaryExpression("!", walk(node.argument.argument.argument));
    }

    // --- Negated comparison: !(a == b) → a != b, !(a < b) → a >= b ---
    const NEGATE_OP = { "==": "!=", "!=": "==", "===": "!==", "!==": "===", "<": ">=", ">": "<=", "<=": ">", ">=": "<" };
    if (t.isUnaryExpression(node) && node.operator === "!" &&
        t.isBinaryExpression(node.argument) && NEGATE_OP[node.argument.operator]) {
      count++;
      return t.binaryExpression(NEGATE_OP[node.argument.operator], walk(node.argument.left), walk(node.argument.right));
    }

    // --- De Morgan: !(a || b) → !a && !b,  !(a && b) → !a || !b ---
    if (t.isUnaryExpression(node) && node.operator === "!" &&
        t.isLogicalExpression(node.argument)) {
      const inner = node.argument;
      const newOp = inner.operator === "||" ? "&&" : "||";
      count++;
      return t.logicalExpression(newOp,
        t.unaryExpression("!", walk(inner.left)),
        t.unaryExpression("!", walk(inner.right)),
      );
    }

    // Recurse
    for (const key of Object.keys(node)) {
      if (SKIP_KEYS.has(key)) continue;
      const val = node[key];
      if (Array.isArray(val)) {
        for (let i = 0; i < val.length; i++) {
          if (val[i] && typeof val[i].type === "string") val[i] = walk(val[i]);
        }
      } else if (val && typeof val.type === "string") {
        node[key] = walk(val);
      }
    }
    return node;
  }

  // Loop until stable — each pass can expose more simplifications
  for (let pass = 0; pass < 10; pass++) {
    const before = count;
    walk(ast);
    if (count === before) break;
  }

  console.log(`  Simplified ${count} redundant conditions`);
}

// ---- normalizeSyntax: convert esoteric patterns to readable forms ----
function normalizeSyntax(ast) {
  let count = 0;

  const replacements = [];

  function collectIn(stmtArray) {
    for (let i = 0; i < stmtArray.length; i++) {
      const s = stmtArray[i];

      // --- Rule: for(;;) body → while(true) body ---
      if (t.isForStatement(s) && !s.init && !s.test && !s.update) {
        count++;
        stmtArray[i] = t.whileStatement(t.booleanLiteral(true), s.body);
      }

      // --- Rule: chained assignment in expression stmt: a = b = c → b = c; a = c ---
      if (t.isExpressionStatement(s) && t.isAssignmentExpression(s.expression) &&
          s.expression.operator === "=" && t.isAssignmentExpression(s.expression.right) &&
          s.expression.right.operator === "=") {
        count++;
        const inner = s.expression.right;
        const outer = s.expression;
        stmtArray[i] = t.expressionStatement(inner);
        stmtArray.splice(i + 1, 0, t.expressionStatement(
          t.assignmentExpression("=", outer.left, inner.left),
        ));
      }

      // --- Rule: return ((a, b)) → a; return b; ---
      if (t.isReturnStatement(s) && s.argument) {
        let rseq = null;
        if (t.isSequenceExpression(s.argument)) rseq = s.argument;
        if (t.isParenthesizedExpression(s.argument) && t.isSequenceExpression(s.argument.expression))
          rseq = s.argument.expression;

        if (rseq) {
          const exprs = rseq.expressions;
          const newStmts = [];
          for (let j = 0; j < exprs.length - 1; j++) {
            newStmts.push(t.expressionStatement(exprs[j]));
          }
          newStmts.push(t.returnStatement(exprs[exprs.length - 1]));
          count += exprs.length - 1;
          stmtArray.splice(i, 1, ...newStmts);
          i += newStmts.length - 1;
        }
      }

      // --- Rule: ((a, b, c)) → a; b; c (unwrap + expand sequence) ---
      if (t.isExpressionStatement(s)) {
        let seq = null;
        // Direct: (a, b, c);
        if (t.isSequenceExpression(s.expression)) seq = s.expression;
        // Wrapped: ((a, b, c));
        if (t.isParenthesizedExpression(s.expression) && t.isSequenceExpression(s.expression.expression))
          seq = s.expression.expression;

        if (seq) {
          const newStmts = seq.expressions.map((e) => t.expressionStatement(e));
          count += seq.expressions.length - 1;
          stmtArray.splice(i, 1, ...newStmts);
          i += newStmts.length - 1;
        }
      }

      // --- Rule: multi-declaration → individual declarations ---
      // let a, b, c → let a; let b; let c;  (same for var, const)
      if (t.isVariableDeclaration(s) && s.declarations.length >= 2) {
        const newStmts = s.declarations.map((d) =>
          t.variableDeclaration(s.kind, [d]),
        );
        count += s.declarations.length - 1;
        stmtArray.splice(i, 1, ...newStmts);
        i += newStmts.length - 1; // skip the ones we just inserted
      }
    }
  }

  function walkLists(node) {
    if (!node || typeof node !== "object") return;
    if ((t.isBlockStatement(node) || node.type === "Program") && Array.isArray(node.body)) {
      collectIn(node.body);
    }
    for (const key of Object.keys(node)) {
      if (SKIP_KEYS.has(key)) continue;
      const val = node[key];
      if (Array.isArray(val)) { for (const v of val) walkLists(v); }
      else if (val && typeof val.type === "string") walkLists(val);
    }
  }
  walkLists(ast);

  // --- AST-level transformations ---
  function walk(node) {
    if (!node || typeof node !== "object") return node;

    // --- normalize: "string" == typeof x → typeof x === "string" ---
    if (t.isBinaryExpression(node) && t.isStringLiteral(node.left) &&
        t.isUnaryExpression(node.right) && node.right.operator === "typeof") {
      const op = node.operator;
      if (op === "==" || op === "===" || op === "!=" || op === "!==") {
        count++;
        const typeofNode = node.right;
        const strNode = node.left;
        node.left = typeofNode;
        node.right = strNode;
        if (op === "==") node.operator = "===";
        if (op === "!=") node.operator = "!==";
      }
    }

    // Recurse
    for (const key of Object.keys(node)) {
      if (SKIP_KEYS.has(key)) continue;
      const val = node[key];
      if (Array.isArray(val)) {
        for (let i = 0; i < val.length; i++) {
          if (val[i] && typeof val[i].type === "string") val[i] = walk(val[i]);
        }
      } else if (val && typeof val.type === "string") {
        node[key] = walk(val);
      }
    }
    return node;
  }
  walk(ast);

  console.log(`  Normalized ${count} syntax patterns`);
}

// ---- inlineConstObjects: replace obj.prop with literal value when obj is a const ----
// Pattern: var cfg = {timeout: 5000}; ... cfg.timeout → 5000
function inlineConstObjects(ast, refGraph) {
  let count = 0;

  // Phase 1: find const object declarations with all-literal properties (all scopes)
  const constObjs = new Map(); // name -> Map<propName, literalNode>
  function findConstObjs(node) {
    if (!node || typeof node !== "object") return;
    if (t.isVariableDeclaration(node)) {
      for (const decl of node.declarations) {
        if (!t.isIdentifier(decl.id) || !t.isObjectExpression(decl.init)) continue;
        const props = new Map();
        let allLiteral = true;
        for (const prop of decl.init.properties) {
          if (!prop.shorthand && !prop.method && t.isIdentifier(prop.key) && t.isLiteral(prop.value)) {
            props.set(prop.key.name, clone(prop.value));
          } else if (!prop.shorthand && !prop.method && t.isStringLiteral(prop.key) && t.isLiteral(prop.value)) {
            props.set(prop.key.value, clone(prop.value));
          } else {
            allLiteral = false;
            break;
          }
        }
        if (allLiteral && props.size > 0) {
          constObjs.set(decl.id.name, props);
        }
      }
    }
    for (const k of Object.keys(node)) {
      if (SKIP_KEYS.has(k)) continue;
      const v = node[k];
      if (Array.isArray(v)) { for (const x of v) findConstObjs(x); }
      else if (v && typeof v.type === "string") findConstObjs(v);
    }
  }
  findConstObjs(ast);

  if (constObjs.size === 0) { console.log("  Inlined 0 const object properties"); return; }

  // Phase 2: check no mutations to these objects
  const mutated = new Set();
  function scanMutations(node) {
    if (!node || typeof node !== "object") return;
    // cfg.x = ... or cfg[x] = ...
    if (t.isAssignmentExpression(node) && t.isMemberExpression(node.left) &&
        t.isIdentifier(node.left.object) && constObjs.has(node.left.object.name)) {
      mutated.add(node.left.object.name);
    }
    // delete cfg.x
    if (t.isUnaryExpression(node) && node.operator === "delete" &&
        t.isMemberExpression(node.argument) && t.isIdentifier(node.argument.object) &&
        constObjs.has(node.argument.object.name)) {
      mutated.add(node.argument.object.name);
    }
    for (const k of Object.keys(node)) {
      if (k === "start" || k === "end" || k === "loc") continue;
      const v = node[k];
      if (Array.isArray(v)) { for (const x of v) scanMutations(x); }
      else if (v && typeof v.type === "string") scanMutations(v);
    }
  }
  scanMutations(ast);
  for (const name of mutated) constObjs.delete(name);

  if (constObjs.size === 0) { console.log("  Inlined 0 const object properties (all mutated)"); return; }

  // Phase 3: replace cfg.prop with literal value
  function walk(node) {
    if (!node || typeof node !== "object") return node;
    if (t.isMemberExpression(node) && !node.computed && t.isIdentifier(node.object) &&
        constObjs.has(node.object.name) && t.isIdentifier(node.property)) {
      const props = constObjs.get(node.object.name);
      if (props.has(node.property.name)) {
        count++;
        return props.get(node.property.name);
      }
    }
    for (const k of Object.keys(node)) {
      if (SKIP_KEYS.has(k)) continue;
      const val = node[k];
      if (Array.isArray(val)) {
        for (let i = 0; i < val.length; i++) {
          if (val[i] && typeof val[i].type === "string") val[i] = walk(val[i]);
        }
      } else if (val && typeof val.type === "string") {
        node[k] = walk(val);
      }
    }
    return node;
  }
  walk(ast);

  console.log(`  Inlined ${count} const object properties`);
}

module.exports = {
  simplify,
  normalizeShortCircuit,
  expandSequences,
  simplifyRedundantConditions,
  normalizeSyntax,
  inlineConstObjects,
};

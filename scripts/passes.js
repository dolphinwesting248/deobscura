// Post-traverse passes: hoisting, constant folding, boolean simplification

const { t, ALERT_PATTERNS } = require("./config");
const { clone, walkStmtLists, walkAST, walkASTDeep, containsYield, containsForAwait } = require("./ast-utils");
const { collectDefined, getExternalRefs } = require("./scope");
const { safeParam } = require("./emit");

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
      if (key === "start" || key === "end" || key === "loc" ||
          key === "leadingComments" || key === "trailingComments" || key === "innerComments") continue;
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
      if (key === "start" || key === "end" || key === "loc" ||
          key === "leadingComments" || key === "trailingComments" || key === "innerComments") continue;
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
      if (k === "start" || k === "end" || k === "loc" ||
          k === "leadingComments" || k === "trailingComments" || k === "innerComments") continue;
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
      if (key === "start" || key === "end" || key === "loc" ||
          key === "leadingComments" || key === "trailingComments" || key === "innerComments") continue;
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
      if (key === "start" || key === "end" || key === "loc" ||
          key === "leadingComments" || key === "trailingComments" || key === "innerComments") continue;
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

// ---- eliminateDeadCode: remove unreachable statements ----
function eliminateDeadCode(ast) {
  let unreachableRemoved = 0;
  let emptyCatchRemoved = 0;
  let falseBranchRemoved = 0;
  let trueBranchFlattened = 0;

  const replacements = [];

  function collectIn(stmtArray) {
    for (let i = 0; i < stmtArray.length; i++) {
      const s = stmtArray[i];

      // --- Unreachable after return/throw/break/continue ---
      if ((t.isReturnStatement(s) || t.isThrowStatement(s) || t.isBreakStatement(s) || t.isContinueStatement(s)) && i + 1 < stmtArray.length) {
        // Count consecutive unreachable statements
        let deadEnd = i + 1;
        while (deadEnd < stmtArray.length) { deadEnd++; unreachableRemoved++; }
        replacements.push({ array: stmtArray, index: i + 1, count: deadEnd - i - 1, stmts: [] });
        break; // only one removal per block
      }

      // --- if (false) { ... } [else { ... }] → remove if-branch, keep else ---
      if (t.isIfStatement(s) && t.isBooleanLiteral(s.test) && s.test.value === false) {
        falseBranchRemoved++;
        const newStmts = [];
        if (s.alternate) {
          if (t.isBlockStatement(s.alternate)) newStmts.push(...s.alternate.body);
          else newStmts.push(s.alternate);
        }
        replacements.push({ array: stmtArray, index: i, count: 1, stmts: newStmts });
      }

      // --- if (true) { A } else { B } → A (remove else) ---
      if (t.isIfStatement(s) && t.isBooleanLiteral(s.test) && s.test.value === true && s.alternate) {
        trueBranchFlattened++;
        if (t.isBlockStatement(s.consequent)) {
          replacements.push({ array: stmtArray, index: i, count: 1, stmts: s.consequent.body });
        } else {
          replacements.push({ array: stmtArray, index: i, count: 1, stmts: [s.consequent] });
        }
      }

      // --- Catch clause with empty body: catch(e) {} → remove catch ---
      if (t.isTryStatement(s) && s.handler && s.handler.body.body.length === 0 && !s.finalizer) {
        emptyCatchRemoved++;
        const newStmts = s.block.body;
        replacements.push({ array: stmtArray, index: i, count: 1, stmts: newStmts });
      }
    }
  }

  function walkStmtLists(node) {
    if (!node || typeof node !== "object") return;
    if (t.isFunction(node)) return;
    if ((t.isBlockStatement(node) || node.type === "Program") && Array.isArray(node.body)) {
      collectIn(node.body);
    }
    for (const key of Object.keys(node)) {
      if (key === "start" || key === "end" || key === "loc" ||
          key === "leadingComments" || key === "trailingComments" || key === "innerComments") continue;
      const val = node[key];
      if (Array.isArray(val)) { for (const v of val) walkStmtLists(v); }
      else if (val && typeof val.type === "string") walkStmtLists(val);
    }
  }

  // Iterate until stable (one removal might expose another)
  for (let pass = 0; pass < 5; pass++) {
    const before = unreachableRemoved + falseBranchRemoved + trueBranchFlattened + emptyCatchRemoved;
    walkStmtLists(ast);
    replacements.reverse().forEach(({ array, index, count, stmts }) => array.splice(index, count, ...stmts));
    replacements.length = 0;
    const after = unreachableRemoved + falseBranchRemoved + trueBranchFlattened + emptyCatchRemoved;
    if (after === before) break;
  }

  console.log(`  Removed ${unreachableRemoved} unreachable statements`);
  console.log(`  Removed ${falseBranchRemoved} if(false) branches`);
  console.log(`  Flattened ${trueBranchFlattened} if(true) branches`);
  console.log(`  Removed ${emptyCatchRemoved} empty catch blocks`);
}

// ---- inlineReadOnlyProperties: replace cfg.PROP with its literal value ----
function inlineReadOnlyProperties(ast) {
  let count = 0;

  // Phase 1: collect ALL const literal objects (any scope — including inside functions)
  const configs = new Map(); // varName -> { propName: valueNode }
  function findConfigs(node) {
    if (!node || typeof node !== "object") return;
    if (t.isVariableDeclaration(node) && node.kind === "const") {
      for (const decl of node.declarations) {
        if (t.isIdentifier(decl.id) && decl.init && t.isObjectExpression(decl.init) &&
            decl.init.properties.every((p) =>
              t.isObjectProperty(p) && !p.computed &&
              (t.isIdentifier(p.key) || t.isStringLiteral(p.key) || t.isNumericLiteral(p.key)),
            )) {
          const props = {};
          for (const p of decl.init.properties) {
            const key = t.isIdentifier(p.key) ? p.key.name : t.isStringLiteral(p.key) ? p.key.value : String(p.key.value);
            props[key] = p.value;
          }
          configs.set(decl.id.name, props);
        }
      }
    }
    for (const key of Object.keys(node)) {
      if (key === "start" || key === "end" || key === "loc" ||
          key === "leadingComments" || key === "trailingComments" || key === "innerComments") continue;
      const val = node[key];
      if (Array.isArray(val)) { for (const v of val) findConfigs(v); }
      else if (val && typeof val.type === "string") findConfigs(val);
    }
  }
  findConfigs(ast);
  console.log(`  Found ${configs.size} config objects`);

  // Phase 2: collect mutated variables (assignment to properties)
  const mutated = new Set();
  function collectMutations(node) {
    if (!node || typeof node !== "object") return;
    if (t.isAssignmentExpression(node) && t.isMemberExpression(node.left) && t.isIdentifier(node.left.object)) {
      mutated.add(node.left.object.name);
    }
    // Also catch update expressions: obj.prop++, delete obj.prop
    if (t.isUpdateExpression(node) && t.isMemberExpression(node.argument) && t.isIdentifier(node.argument.object)) {
      mutated.add(node.argument.object.name);
    }
    for (const key of Object.keys(node)) {
      if (key === "start" || key === "end" || key === "loc" ||
          key === "leadingComments" || key === "trailingComments" || key === "innerComments") continue;
      const val = node[key];
      if (Array.isArray(val)) { for (const v of val) collectMutations(v); }
      else if (val && typeof val.type === "string") collectMutations(val);
    }
  }
  collectMutations(ast);
  for (const name of mutated) configs.delete(name);
  console.log(`  ${configs.size} remain after mutation check`);

  // Phase 3: inline VAR.PROP → literal across the entire AST
  function walk(node) {
    if (!node || typeof node !== "object") return node;

    // VAR.PROP → literal value
    if (t.isMemberExpression(node) && !node.computed && t.isIdentifier(node.object) && t.isIdentifier(node.property)) {
      const cfg = configs.get(node.object.name);
      if (cfg && cfg[node.property.name] !== undefined) {
        count++;
        return clone(cfg[node.property.name]);
      }
    }

    // Recurse into all children (including function bodies)
    for (const key of Object.keys(node)) {
      if (key === "start" || key === "end" || key === "loc" ||
          key === "leadingComments" || key === "trailingComments" || key === "innerComments") continue;
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

  console.log(`  Inlined ${count} read-only property accesses`);
}

// cloneNodeLit removed — use clone() from ast-utils.js instead

// ---- removeUnusedHelpers: delete function declarations that are never referenced ----
// General approach: any function declaration whose name never appears as an Identifier
// (outside its own definition) is dead. Works on any obfuscated codebase.
function removeUnusedHelpers(ast) {
  let removed = 0;

  // Phase 1: collect all function declaration names + their definition sites
  const fnDecls = new Map(); // name -> { node, parentArray, index }
  let uniqueIdx = 0;

  function collectFnDecls(node, parentArray) {
    if (!node || typeof node !== "object") return;

    if (t.isFunctionDeclaration(node) && node.id) {
      const key = node.id.name + "##" + (uniqueIdx++); // unique key per occurrence
      fnDecls.set(key, { name: node.id.name, node, array: parentArray });
    }

    if (t.isBlockStatement(node) && Array.isArray(node.body)) {
      for (let i = 0; i < node.body.length; i++) {
        if (t.isFunctionDeclaration(node.body[i]) && node.body[i].id) {
          const key = node.body[i].id.name + "##" + (uniqueIdx++);
          fnDecls.set(key, { name: node.body[i].id.name, node: node.body[i], array: node.body, index: i });
        }
      }
    }

    for (const key of Object.keys(node)) {
      if (key === "start" || key === "end" || key === "loc" ||
          key === "leadingComments" || key === "trailingComments" || key === "innerComments") continue;
      const val = node[key];
      if (Array.isArray(val)) {
        for (let i = 0; i < val.length; i++) {
          if (val[i] && typeof val[i].type === "string") collectFnDecls(val[i], val);
        }
      } else if (val && typeof val.type === "string") {
        collectFnDecls(val, null);
      }
    }
  }
  collectFnDecls(ast, null);

  // Phase 2: collect all identifier usages (references to function names)
  const referenced = new Set();
  function collectRefs(node, contextFn) {
    if (!node || typeof node !== "object") return;

    // Track which function scope we're in
    let newContext = contextFn;
    if (t.isFunctionDeclaration(node) && node.id) newContext = node;

    // Identifier used as callee, argument, assignment, or any expression
    if (t.isIdentifier(node)) {
      referenced.add(node.name);
    }

    for (const key of Object.keys(node)) {
      if (key === "start" || key === "end" || key === "loc" ||
          key === "leadingComments" || key === "trailingComments" || key === "innerComments") continue;
      const val = node[key];
      if (Array.isArray(val)) { for (const v of val) collectRefs(v, newContext); }
      else if (val && typeof val.type === "string") collectRefs(val, newContext);
    }
  }
  collectRefs(ast, null);

  // Phase 3: filter — a name is "dead" if ALL its declarations are dead AND it's never referenced
  const deadNames = new Set();
  for (const [key, { name, node, array, index }] of fnDecls) {
    if (!referenced.has(name)) {
      deadNames.add(key);
    }
  }

  // Don't remove program-level functions (they might be entry points)
  const toRemove = [];
  for (const [key, { name, node, array, index }] of fnDecls) {
    if (!deadNames.has(key)) continue;
    if (array === ast.program.body) continue; // skip program-level
    if (!node.id || !node.id.name.startsWith("_0x")) continue; // only obfuscated helpers
    toRemove.push({ name, array, node, index });
  }

  // Apply removals in reverse order
  const removedNames = new Set();
  const removalMap = new Map(); // array -> indices to remove
  for (const { array, node } of toRemove) {
    if (!removalMap.has(array)) removalMap.set(array, []);
    removalMap.get(array).push(node);
    removedNames.add(node.id.name);
    removed++;
  }

  for (const [arr, nodes] of removalMap) {
    for (const n of nodes) {
      const idx = arr.indexOf(n);
      if (idx >= 0) arr.splice(idx, 1);
    }
  }

  console.log(`  Removed ${removed} unused helper functions (${removedNames.size} unique names)`);
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
    }
  }

  function walkLists(node) {
    if (!node || typeof node !== "object") return;
    if ((t.isBlockStatement(node) || node.type === "Program") && Array.isArray(node.body)) {
      collectIn(node.body);
    }
    for (const key of Object.keys(node)) {
      if (key === "start" || key === "end" || key === "loc" ||
          key === "leadingComments" || key === "trailingComments" || key === "innerComments") continue;
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
      if (key === "start" || key === "end" || key === "loc" ||
          key === "leadingComments" || key === "trailingComments" || key === "innerComments") continue;
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
      if (key === "start" || key === "end" || key === "loc" ||
          key === "leadingComments" || key === "trailingComments" || key === "innerComments") continue;
      const val = node[key];
      if (Array.isArray(val)) { for (const v of val) walkLists(v); }
      else if (val && typeof val.type === "string") walkLists(val);
    }
  }
  walkLists(ast);

  // --- AST-level transformations ---
  function walk(node) {
    if (!node || typeof node !== "object") return node;

    // Recurse
    for (const key of Object.keys(node)) {
      if (key === "start" || key === "end" || key === "loc" ||
          key === "leadingComments" || key === "trailingComments" || key === "innerComments") continue;
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

// ---- extractInlineFunctions: lift embedded function expressions to top level ----
// Targets: return statement bodies, variable initializers, assignment RHS
// Result: clean return values, readable function names
function extractInlineFunctions(ast) {
  let count = 0;
  const newFns = []; // collected new function declarations

  function walk(node, parentArray, stmtIndex, enclosingFn) {
    if (!node || typeof node !== "object") return;

    // --- Return statement with FunctionExpression/ArrowFunction ---
    if (t.isReturnStatement(node) && node.argument) {
      const fn = findEmbeddedFn(node.argument);
      if (fn && t.isBlockStatement(fn.body)) {
        const name = `_sub_return_fn${++count}`;
        // Collect external refs from the function body
        const fnParamNames = new Set(fn.params.map((p) => (t.isIdentifier(p) ? p.name : null)).filter(Boolean));
        const defined = collectDefined(fn.body.body);
        for (const n of fnParamNames) defined.add(n);
        const extRefs = getExternalRefs(fn.body, defined);
        // Combine params + external refs
        const allParams = [
          ...fn.params.map((p) => cloneParam(p)),
          ...extRefs.filter((r) => !fnParamNames.has(r)).map((r) => t.identifier(r)),
        ];
        const rfFn = t.functionDeclaration(t.identifier(name), allParams, fn.body);
        if (fn.async) rfFn.async = true;
        if (fn.generator) rfFn.generator = true;
        newFns.push(rfFn);
        // Replace function expression with reference
        replaceFnRef(node, "argument", fn, t.identifier(name));
      }
    }

    // --- Variable declaration init with function ---
    if (t.isVariableDeclaration(node)) {
      for (const decl of node.declarations) {
        if (decl.init && (t.isFunctionExpression(decl.init) || t.isArrowFunctionExpression(decl.init)) &&
            t.isBlockStatement(decl.init.body) && decl.init.body.body.length > 0) {
          const varName = t.isIdentifier(decl.id) ? decl.id.name : `var${count}`;
          const name = `_sub_${varName}_fn`;
          const fn = decl.init;
          const params = fn.params.map((p) => cloneParam(p));
          const vFn = t.functionDeclaration(t.identifier(name), params, fn.body);
          if (fn.async) vFn.async = true;
          if (fn.generator) vFn.generator = true;
          newFns.push(vFn);
          decl.init = t.identifier(name);
          count++;
        }
      }
    }

    // Walk into ALL function bodies — we need to find embedded fns everywhere
    for (const key of Object.keys(node)) {
      if (key === "start" || key === "end" || key === "loc" ||
          key === "leadingComments" || key === "trailingComments" || key === "innerComments") continue;
      const val = node[key];
      if (Array.isArray(val)) {
        for (let i = 0; i < val.length; i++) {
          if (val[i] && typeof val[i].type === "string") walk(val[i], val, i, enclosingFn);
        }
      } else if (val && typeof val.type === "string") {
        walk(val, null, -1, enclosingFn);
      }
    }
  }

  function findEmbeddedFn(node) {
    if (t.isFunctionExpression(node) || t.isArrowFunctionExpression(node)) return t.isBlockStatement(node.body) ? node : null;
    // return function(){...}()  — IIFE: function expression as callee
    if (t.isCallExpression(node)) {
      if (t.isFunctionExpression(node.callee) || t.isArrowFunctionExpression(node.callee)) {
        return t.isBlockStatement(node.callee.body) ? node.callee : null;
      }
      // Drill through: fnExpr[key]() → function is the callee's object
      return findEmbeddedFn(node.callee);
    }
    // return function(){}[key]  — function expression as MemberExpression object
    if (t.isMemberExpression(node)) {
      if (t.isFunctionExpression(node.object) || t.isArrowFunctionExpression(node.object)) {
        return t.isBlockStatement(node.object.body) ? node.object : null;
      }
      return findEmbeddedFn(node.object);
    }
    // a0_0x5465 = function(...){...}  — the assignment's RHS is the function
    if (t.isAssignmentExpression(node) && node.operator === "=") return findEmbeddedFn(node.right);
    // (function(){...})(), a0_0x5465(args)  — comma expressions
    if (t.isSequenceExpression(node)) {
      for (const expr of node.expressions) {
        const found = findEmbeddedFn(expr);
        if (found) return found;
      }
    }
    return null;
  }

  function replaceFnRef(parent, key, oldFn, newId) {
    const node = parent[key];
    if (t.isFunctionExpression(node) || t.isArrowFunctionExpression(node)) {
      parent[key] = newId;
    } else if (t.isCallExpression(node)) {
      if (node.callee === oldFn) { node.callee = newId; }
      else replaceFnRef(node, "callee", oldFn, newId);
    } else if (t.isMemberExpression(node)) {
      if (node.object === oldFn) { node.object = newId; }
      else replaceFnRef(node, "object", oldFn, newId);
    } else if (t.isAssignmentExpression(node) && node.operator === "=") {
      replaceFnRef(node, "right", oldFn, newId);
    } else if (t.isSequenceExpression(node)) {
      for (let i = 0; i < node.expressions.length; i++) {
        if (t.isAssignmentExpression(node.expressions[i]) && t.isFunctionExpression(node.expressions[i].right)) {
          replaceFnRef(node.expressions[i], "right", oldFn, newId);
        }
      }
    }
  }

  function cloneParam(p) {
    if (t.isIdentifier(p)) return t.identifier(safeParam(p.name));
    return { ...p, start: undefined, end: undefined, loc: undefined };
  }

  // After extraction, fix functions that need async/generator due to for-await/yield
  for (const fn of newFns) {
    if (!fn.async && containsForAwait(fn.body)) fn.async = true;
    if (!fn.generator && containsYield(fn.body)) fn.generator = true;
  }

  walk(ast);
  // Append newly created functions to program body
  for (const fn of newFns) ast.program.body.push(fn);

  console.log(`  Extracted ${count} inline function expressions`);
}

// ---- sanitizeReservedWords: rename reserved-word identifiers to safe alternatives ----
// Obfuscated code commonly uses reserved words (let, default, if, etc.) as parameter
// and variable names. This works in sloppy-mode parsers but breaks when downstream
// tools re-parse the generated output. This pass runs FIRST to clean identifiers.
function sanitizeReservedWords(ast) {
  const RW = new Set([
    "break", "case", "catch", "continue", "debugger", "default", "delete",
    "do", "else", "finally", "for", "function", "if", "in", "instanceof",
    "new", "return", "switch", "this", "throw", "try", "typeof", "var",
    "void", "while", "with", "class", "const", "enum", "export", "extends",
    "import", "super", "implements", "interface", "let", "package",
    "private", "protected", "public", "static", "yield", "await", "async",
  ]);

  // Phase 1: collect every identifier already in use (to avoid collisions)
  const allNames = new Set();
  function scanAll(n) {
    if (!n || typeof n !== "object") return;
    if (t.isIdentifier(n)) allNames.add(n.name);
    for (const k of Object.keys(n)) {
      if (k === "start" || k === "end" || k === "loc" ||
          k === "leadingComments" || k === "trailingComments" || k === "innerComments") continue;
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
      if (k === "start" || k === "end" || k === "loc" ||
          k === "leadingComments" || k === "trailingComments" || k === "innerComments") continue;
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
      if (k === "start" || k === "end" || k === "loc" ||
          k === "leadingComments" || k === "trailingComments" || k === "innerComments") continue;
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
      if (matches.length > 0) {
        if (!node.leadingComments) node.leadingComments = [];
        const parts = matches.map((a) => `[${a.label}] ${a.matches.join(" · ")}`);
        node.leadingComments.push({ type: "CommentLine", value: " " + parts.join("  ") });
        count++;
      }
    }
    for (const k of Object.keys(node)) {
      if (k === "start" || k === "end" || k === "loc" ||
          k === "leadingComments" || k === "trailingComments" || k === "innerComments") continue;
      const v = node[k];
      if (Array.isArray(v)) { for (const x of v) walkFn(x); }
      else if (v && typeof v.type === "string") walkFn(v);
    }
  }
  walkFn(ast);

  console.log(`  Annotated ${count} functions with security alerts`);
}

module.exports = {
  sanitizeReservedWords,
  hoistDeclarations,
  simplify,
  normalizeShortCircuit,
  expandSequences,
  eliminateDeadCode,
  inlineReadOnlyProperties,
  removeUnusedHelpers,
  simplifyRedundantConditions,
  inlinePureWrappers,
  sortByCallTree,
  inlineSingleCallerFns,
  normalizeSyntax,
  extractInlineFunctions,
  annotateAlerts,
};

// ---- inlinePureWrappers: remove functions that are just return call(args) ----
// General: any function whose body is a single return statement calling another.
function inlinePureWrappers(ast) {
  let count = 0;
  const wrappers = new Map(); // wrapperName -> targetName
  const wrapperParams = new Map(); // wrapperName -> [param names]
  const toRemove = new Map(); // array -> [indices to splice]

  // Phase 1: find wrappers
  for (let i = 0; i < ast.program.body.length; i++) {
    const stmt = ast.program.body[i];
    if (!t.isFunctionDeclaration(stmt) || !stmt.id) continue;
    const body = stmt.body.body;
    if (body.length === 1 && t.isReturnStatement(body[0]) &&
        body[0].argument && t.isCallExpression(body[0].argument) &&
        t.isIdentifier(body[0].argument.callee)) {
      const target = body[0].argument.callee.name;
      // Only inline if target exists at program level
      const targetExists = ast.program.body.some(s => t.isFunctionDeclaration(s) && s.id && s.id.name === target);
      if (targetExists) {
        wrappers.set(stmt.id.name, target);
        wrapperParams.set(stmt.id.name, stmt.params.map(p => t.isIdentifier(p) ? p.name : null).filter(Boolean));
        if (!toRemove.has(ast.program.body)) toRemove.set(ast.program.body, []);
        toRemove.get(ast.program.body).push(i);
      }
    }
  }

  // Phase 2: replace all call sites of wrappers with calls to targets
  function walk(node) {
    if (!node || typeof node !== "object") return;
    if (t.isCallExpression(node) && t.isIdentifier(node.callee) && wrappers.has(node.callee.name)) {
      const target = wrappers.get(node.callee.name);
      const params = wrapperParams.get(node.callee.name);
      // Map params: _sub_X(a, b) -> _sub_Y(a, b). If args match params, use directly
      if (params && node.arguments.length === params.length) {
        node.callee = t.identifier(target);
        count++;
      }
    }
    for (const k of Object.keys(node)) {
      if (k === "start" || k === "end" || k === "loc" ||
          k === "leadingComments" || k === "trailingComments" || k === "innerComments") continue;
      const v = node[k];
      if (Array.isArray(v)) { for (const x of v) walk(x); }
      else if (v && typeof v.type === "string") { const old = {...node}; walk(v); }
    }
  }
  walk(ast);

  // Phase 3: remove wrappers from program body (reverse order)
  const removalMap = toRemove.get(ast.program.body) || [];
  removalMap.sort((a, b) => b - a);
  for (const idx of removalMap) {
    ast.program.body.splice(idx, 1);
  }

  console.log(`  Inlined ${count} wrapper calls, removed ${wrappers.size} wrappers`);
}

// ---- sortByCallTree: reorder _sub_ functions by execution dependency ----
// General: topological sort so callees appear before callers.
function sortByCallTree(ast) {
  // Build adjacency: who calls whom (among _sub_ functions)
  const calls = new Map(); // callerName -> [calleeName]
  const allNames = new Set();

  for (const stmt of ast.program.body) {
    if (t.isFunctionDeclaration(stmt) && stmt.id) {
      allNames.add(stmt.id.name);
    }
  }

  function collectEdges(node, enclosingFn) {
    if (!node || typeof node !== "object") return;
    if (t.isCallExpression(node) && t.isIdentifier(node.callee) && allNames.has(node.callee.name) && enclosingFn) {
      if (!calls.has(enclosingFn)) calls.set(enclosingFn, []);
      if (!calls.get(enclosingFn).includes(node.callee.name)) calls.get(enclosingFn).push(node.callee.name);
    }
    for (const k of Object.keys(node)) {
      if (k === "start" || k === "end" || k === "loc" ||
          k === "leadingComments" || k === "trailingComments" || k === "innerComments") continue;
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

  // Topological sort (Kahn's algorithm)
  const inDegree = new Map();
  for (const name of allNames) inDegree.set(name, 0);
  for (const [, callees] of calls) {
    for (const c of callees) {
      if (inDegree.has(c)) inDegree.set(c, (inDegree.get(c) || 0) + 1);
    }
  }

  // Separate _sub_ functions from non-_sub_ functions
  const subFns = [];
  const otherFns = [];
  for (const stmt of ast.program.body) {
    if (t.isFunctionDeclaration(stmt) && stmt.id && stmt.id.name.startsWith("_sub_")) {
      subFns.push(stmt);
    } else {
      otherFns.push(stmt);
    }
  }

  // Sort _sub_ functions: leaves first (inDegree=0), then dependents
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
          const fnNode = subFns.find(f => f.id.name === c);
          if (fnNode) queue.push(fnNode);
        }
      }
    }
  }

  // Add remaining (circular dependencies or non-_sub_)
  for (const fn of subFns) {
    if (!visited.has(fn.id.name)) sorted.push(fn);
  }

  // Rebuild: non-_sub_ functions first, then sorted _sub_ functions
  ast.program.body = [...otherFns, ...sorted];
  console.log(`  Reordered ${sorted.length} functions by call tree`);
}

// ---- inlineSingleCallerFns: inline functions called from exactly one place ----
function inlineSingleCallerFns(ast) {
  let count = 0;

  // Phase 1: count callers for each _sub_ function
  const callers = new Map(); // calleeName -> Set(callerName)
  const allSubNames = new Set();

  for (const stmt of ast.program.body) {
    if (t.isFunctionDeclaration(stmt) && stmt.id && stmt.id.name.startsWith("_sub_")) {
      allSubNames.add(stmt.id.name);
    }
  }

  function countCallers(node, enclosingFn) {
    if (!node || typeof node !== "object") return;
    if (t.isCallExpression(node) && t.isIdentifier(node.callee) && allSubNames.has(node.callee.name) && enclosingFn) {
      if (!callers.has(node.callee.name)) callers.set(node.callee.name, new Set());
      callers.get(node.callee.name).add(enclosingFn);
    }
    for (const k of Object.keys(node)) {
      if (k === "start" || k === "end" || k === "loc" ||
          k === "leadingComments" || k === "trailingComments" || k === "innerComments") continue;
      const v = node[k];
      if (Array.isArray(v)) { for (const x of v) countCallers(x, enclosingFn); }
      else if (v && typeof v.type === "string") countCallers(v, enclosingFn);
    }
  }

  for (const stmt of ast.program.body) {
    if (t.isFunctionDeclaration(stmt) && stmt.id) {
      countCallers(stmt.body, stmt.id.name);
    }
  }

  // Phase 2: find single-caller functions
  const singleCallers = new Map(); // calleeName -> callerName
  for (const [callee, callerSet] of callers) {
    if (callerSet.size === 1) {
      singleCallers.set(callee, [...callerSet][0]);
    }
  }

  // Phase 3: collect the function node for each single-caller candidate
  const fnNodes = new Map(); // name -> FunctionDeclaration node
  for (const stmt of ast.program.body) {
    if (t.isFunctionDeclaration(stmt) && stmt.id) fnNodes.set(stmt.id.name, stmt);
  }

  // Phase 4: inline each single-caller into its caller
  const toRemove = new Set();
  const replacements = []; // { parentArray, index, newNode }

  function walkInliner(node, parentArray, stmtIndex, enclosingFn) {
    if (!node || typeof node !== "object") return;

    // Found a call expression that targets a single-caller
    if (t.isCallExpression(node) && t.isIdentifier(node.callee) && singleCallers.has(node.callee.name) &&
        singleCallers.get(node.callee.name) === enclosingFn) {
      const calleeName = node.callee.name;
      const calleeNode = fnNodes.get(calleeName);
      if (!calleeNode) return;

      // Build IIFE: ( [async] function(params) { body })(args)
      const iifeFn = t.functionExpression(null, calleeNode.params.map(p => cloneParam(p)), calleeNode.body);
      if (calleeNode.async) iifeFn.async = true;
      const iife = t.callExpression(iifeFn, node.arguments.map(a => cloneArg(a)));

      // If the call is in an expression context, replace the call with the IIFE
      // If the call is a standalone expression statement, replace the whole statement
      if (parentArray && stmtIndex !== undefined) {
        replacements.push({ array: parentArray, index: stmtIndex, node: iife, type: "expression" });
      } else {
        // Nested in an expression — replace in place
        Object.assign(node, iife);
      }

      toRemove.add(calleeName);
      count++;
    }

    // Recurse
    for (const k of Object.keys(node)) {
      if (k === "start" || k === "end" || k === "loc" ||
          k === "leadingComments" || k === "trailingComments" || k === "innerComments") continue;
      const v = node[k];
      if (Array.isArray(v)) {
        for (let i = 0; i < v.length; i++) {
          if (v[i] && typeof v[i].type === "string") {
            if (t.isCallExpression(v[i]) && t.isIdentifier(v[i].callee) && singleCallers.has(v[i].callee.name) &&
                singleCallers.get(v[i].callee.name) === enclosingFn) {
              // Replace argument-position call with IIFE
              const cn = v[i].callee.name;
              const cf = fnNodes.get(cn);
              if (cf) {
                const af = t.functionExpression(null, cf.params.map(p => cloneParam(p)), cf.body);
                if (cf.async) af.async = true;
                v[i] = t.callExpression(af, v[i].arguments.map(a => cloneArg(a)));
                toRemove.add(cn);
                count++;
              }
            } else {
              walkInliner(v[i], v, i, enclosingFn);
            }
          }
        }
      } else if (v && typeof v.type === "string") {
        walkInliner(v, null, -1, enclosingFn);
      }
    }
  }

  function cloneParam(p) { if (t.isIdentifier(p)) return t.identifier(safeParam(p.name)); return {...p}; }
  function cloneArg(a) { if (!a||typeof a!=="object") return a; const c={}; for(const k of Object.keys(a)){if(k==='start'||k==='end'||k==='loc')continue;const v=a[k];if(Array.isArray(v)){c[k]=v.map(x=>cloneArg(x));}else if(v&&typeof v.type==='string'){c[k]=cloneArg(v);}else{c[k]=v;}}return c;}

  for (const stmt of ast.program.body) {
    if (t.isFunctionDeclaration(stmt) && stmt.id && allSubNames.has(stmt.id.name)) {
      walkInliner(stmt.body, stmt.body.body, null, stmt.id.name);
    }
  }

  // Apply replacements in reverse
  replacements.reverse().forEach(({ array, index, node, type }) => {
    if (type === "expression" && t.isExpressionStatement(array[index])) {
      array[index].expression = node;
    }
  });

  // Remove inlined functions from program body
  ast.program.body = ast.program.body.filter(s => !(t.isFunctionDeclaration(s) && s.id && toRemove.has(s.id.name)));

  console.log(`  Inlined ${count} single-caller functions, removed ${toRemove.size} declarations`);
}

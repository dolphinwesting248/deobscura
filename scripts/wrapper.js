// Extracts top-level IIFEs from the comma chain into named wrappers

const { t } = require("./config");
const { descIIFE, clone, isIIFE } = require("./ast-utils");
const { createSubFn } = require("./emit");

function extractTopLevelIIFEs(ast) {
  const newBody = [];
  const allSubFns = [];

  for (const stmt of ast.program.body) {
    if (!t.isExpressionStatement(stmt) || !t.isSequenceExpression(stmt.expression)) {
      newBody.push(stmt);
      continue;
    }

    const exprs = [];
    (function flatten(e) {
      if (t.isSequenceExpression(e)) { for (const ex of e.expressions) flatten(ex); }
      else exprs.push(e);
    })(stmt.expression);

    const newExprs = [];
    let iifeIdx = 0;
    for (const expr of exprs) {
      // Regular IIFE: (function(){...})()
      if (isIIFE(expr)) {
        iifeIdx++;
        const fn = expr.callee;
        const lineNum = expr.loc ? expr.loc.start.line : iifeIdx;
        const name = `_S_program_${descIIFE(fn.body.body)}_l${lineNum}`;

        if (t.isFunctionExpression(fn) && t.isBlockStatement(fn.body) && fn.body.body.length > 0) {
          const wrapperFn = createSubFn(name, fn.params.map((p) => clone(p)), fn.body.body, expr);
          allSubFns.push(wrapperFn);
          newExprs.push(t.callExpression(t.identifier(name), expr.arguments.map((a) => clone(a))));
        } else { newExprs.push(expr); }
      }
      // Negated IIFE: !function(){...}()
      else if (t.isUnaryExpression(expr) && expr.operator === "!" && t.isCallExpression(expr.argument) &&
               (t.isFunctionExpression(expr.argument.callee) || t.isArrowFunctionExpression(expr.argument.callee))) {
        iifeIdx++;
        const inner = expr.argument;
        const fn = inner.callee;
        const lineNum = expr.loc ? expr.loc.start.line : iifeIdx;
        const name = `_S_program_${descIIFE(fn.body.body)}_l${lineNum}`;

        if ((t.isFunctionExpression(fn) || t.isArrowFunctionExpression(fn)) && t.isBlockStatement(fn.body) && fn.body.body.length > 0) {
          const wrapperFn = createSubFn(name, fn.params.map((p) => clone(p)), fn.body.body, expr);
          allSubFns.push(wrapperFn);
          newExprs.push(t.unaryExpression("!", t.callExpression(t.identifier(name), inner.arguments.map((a) => clone(a)))));
        } else { newExprs.push(expr); }
      }
      else { newExprs.push(expr); }
    }

    if (newExprs.length === 1) { newBody.push(t.expressionStatement(newExprs[0])); }
    else {
      let combined = newExprs[0];
      for (let i = 1; i < newExprs.length; i++) combined = t.sequenceExpression([combined, newExprs[i]]);
      newBody.push(t.expressionStatement(combined));
    }
  }

  ast.program.body = newBody;
  return allSubFns;
}

module.exports = { extractTopLevelIIFEs };

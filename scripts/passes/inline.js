// Inlining passes

const { t } = require("../config");
const { SKIP_KEYS, isSubFn, SUB_FN_PREFIX } = require("../constants");
const { clone, containsYield, containsForAwait } = require("../ast-utils");
const { collectDefined, getExternalRefs } = require("../scope");
const { safeParam } = require("../emit");

// ---- inlineReadOnlyProperties: replace cfg.PROP with its literal value ----
function inlineReadOnlyProperties(ast, refGraph) {
  let count = 0;

  // Phase 1: collect ALL literal object declarations (any scope, var/let/const)
  const configs = new Map(); // varName -> { propName: valueNode }
  function findConfigs(node) {
    if (!node || typeof node !== "object") return;
    if (t.isVariableDeclaration(node)) {
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
      if (SKIP_KEYS.has(key)) continue;
      const val = node[key];
      if (Array.isArray(val)) { for (const v of val) findConfigs(v); }
      else if (val && typeof val.type === "string") findConfigs(val);
    }
  }
  findConfigs(ast);
  console.log(`  Found ${configs.size} config objects`);

  // Phase 2: collect mutated variables (assignment to properties)
  if (refGraph) {
    // Reuse shared refGraph — filter to direct mutations
    for (const name of refGraph.isMutated) configs.delete(name);
  } else {
    const mutated = new Set();
    function collectMutations(node) {
      if (!node || typeof node !== "object") return;
      if (t.isAssignmentExpression(node) && t.isMemberExpression(node.left) && t.isIdentifier(node.left.object)) {
        mutated.add(node.left.object.name);
      }
      if (t.isUpdateExpression(node) && t.isMemberExpression(node.argument) && t.isIdentifier(node.argument.object)) {
        mutated.add(node.argument.object.name);
      }
      for (const key of Object.keys(node)) {
        if (SKIP_KEYS.has(key)) continue;
        const val = node[key];
        if (Array.isArray(val)) { for (const v of val) collectMutations(v); }
        else if (val && typeof val.type === "string") collectMutations(val);
      }
    }
    collectMutations(ast);
    for (const name of mutated) configs.delete(name);
  }
  console.log(`  ${configs.size} remain after mutation check`);

  // Phase 3: inline VAR.PROP → literal across the entire AST
  function walk(node) {
    if (!node || typeof node !== "object") return node;

    // VAR.PROP → literal value
    if (t.isMemberExpression(node) && !node.computed && t.isIdentifier(node.object) && t.isIdentifier(node.property)) {
      const cfg = configs.get(node.object.name);
      if (cfg && Object.prototype.hasOwnProperty.call(cfg, node.property.name)) {
        count++;
        return clone(cfg[node.property.name]);
      }
    }

    // Recurse into all children (including function bodies)
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

  console.log(`  Inlined ${count} read-only property accesses`);
}

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
    if (body.length !== 1 || !t.isReturnStatement(body[0]) || !body[0].argument) continue;
    const retArg = body[0].argument;
    let target = null;
    let matched = false;

    // Pattern 1: return target(args) — simple pass-through
    if (t.isCallExpression(retArg) && t.isIdentifier(retArg.callee)) {
      target = retArg.callee.name;
      matched = true;
    }
    // Pattern 2: return target.apply(this, arguments) — apply bridge
    if (!matched && t.isCallExpression(retArg) && t.isMemberExpression(retArg.callee) &&
        t.isIdentifier(retArg.callee.property, { name: "apply" }) &&
        t.isIdentifier(retArg.callee.object)) {
      target = retArg.callee.object.name;
      matched = true;
    }
    // Pattern 3: return target.call(this, ...params) — call bridge
    if (!matched && t.isCallExpression(retArg) && t.isMemberExpression(retArg.callee) &&
        t.isIdentifier(retArg.callee.property, { name: "call" }) &&
        t.isIdentifier(retArg.callee.object)) {
      target = retArg.callee.object.name;
      matched = true;
    }

    if (matched && target) {
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
      // Map params: _S_X(a, b) -> _S_Y(a, b). If args match params, use directly
      if (params && node.arguments.length === params.length) {
        node.callee = t.identifier(target);
        count++;
      }
    }
    for (const k of Object.keys(node)) {
      if (SKIP_KEYS.has(k)) continue;
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

// ---- inlineArithmeticWrappers: collapse trivial operator wrappers ----
// Pattern: function _S_op(a, b) { return a + b; } → inline at call sites
function inlineArithmeticWrappers(ast) {
  let count = 0;
  const wrappers = new Map(); // name -> { params, body (expression) }

  // Phase 1: find wrapper functions at program level only (fast path)
  for (const stmt of ast.program.body) {
    if (!t.isFunctionDeclaration(stmt) || !stmt.id) continue;
    const node = stmt;
    const body = node.body.body;
    if (body.length === 1 && t.isReturnStatement(body[0]) && body[0].argument) {
      const expr = body[0].argument;
      const paramNames = new Set(node.params.filter(p => t.isIdentifier(p)).map(p => p.name));
      if (paramNames.size > 0 && paramNames.size <= 3) {
        const idents = [];
        const idStack = [expr];
        while (idStack.length > 0) {
          const n = idStack.pop();
          if (!n || typeof n !== "object") continue;
          if (t.isIdentifier(n)) { idents.push(n.name); continue; }
          for (const k of Object.keys(n)) {
            if (k === "start" || k === "end" || k === "loc") continue;
            const v = n[k];
            if (v && typeof v.type === "string") idStack.push(v);
          }
        }
        const usesOnlyParams = idents.every(id => paramNames.has(id));
        if (usesOnlyParams && idents.length <= 6) {
          wrappers.set(node.id.name, { params: node.params.map(p => clone(p)), expr: clone(expr) });
        }
      }
    }
  }

  if (wrappers.size === 0) { console.log(`  Inlined 0 arithmetic wrappers`); return; }

  // Phase 2: replace call sites (iterative substitute)
  function substitute(expr, paramMap) {
    if (t.isIdentifier(expr)) return paramMap.has(expr.name) ? clone(paramMap.get(expr.name)) : clone(expr);
    const result = clone(expr);
    const subStack = [result];
    while (subStack.length > 0) {
      const n = subStack.pop();
      if (!n || typeof n !== "object") continue;
      if (t.isIdentifier(n) && paramMap.has(n.name)) {
        const r = paramMap.get(n.name);
        for (const k of Object.keys(r)) n[k] = r[k];
      }
      for (const k of Object.keys(n)) {
        if (k === "start" || k === "end" || k === "loc" ||
            k === "leadingComments" || k === "trailingComments" || k === "innerComments") continue;
        const v = n[k];
        if (v && typeof v.type === "string") subStack.push(v);
      }
    }
    return result;
  }

  // Iterative AST walk to avoid stack overflow on large files
  const stack = [ast];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || typeof node !== "object") continue;
    if (t.isCallExpression(node) && t.isIdentifier(node.callee) && wrappers.has(node.callee.name)) {
      const w = wrappers.get(node.callee.name);
      if (node.arguments.length === w.params.length) {
        const paramMap = new Map();
        for (let i = 0; i < w.params.length; i++) {
          if (t.isIdentifier(w.params[i])) paramMap.set(w.params[i].name, node.arguments[i]);
        }
        const inlined = substitute(w.expr, paramMap);
        for (const k of Object.keys(node)) delete node[k];
        for (const k of Object.keys(inlined)) node[k] = inlined[k];
        count++;
      }
    }
    for (const k of Object.keys(node)) {
      if (SKIP_KEYS.has(k)) continue;
      const v = node[k];
      if (Array.isArray(v)) { for (let i = v.length - 1; i >= 0; i--) if (v[i] && typeof v[i] === "object") stack.push(v[i]); }
      else if (v && typeof v.type === "string") stack.push(v);
    }
  }

  console.log(`  Inlined ${count} arithmetic wrapper calls`);
}

// ---- inlineSingleCallerFns: inline functions called from exactly one place ----
function inlineSingleCallerFns(ast, callGraph) {
  let count = 0;

  // Phase 1: count callers for each _S_ function
  const allSubNames = new Set();
  let callers; // calleeName -> Set(callerName)

  for (const stmt of ast.program.body) {
    if (t.isFunctionDeclaration(stmt) && stmt.id && isSubFn(stmt.id.name)) {
      allSubNames.add(stmt.id.name);
    }
  }

  if (callGraph) {
    // Reuse shared call graph — filter to _S_ callees only
    callers = new Map();
    for (const [callee, callerSet] of callGraph.reverse) {
      if (allSubNames.has(callee)) {
        callers.set(callee, callerSet);
      }
    }
  } else {
    callers = new Map();

    function countCallers(node, enclosingFn) {
      if (!node || typeof node !== "object") return;
      if (t.isCallExpression(node) && t.isIdentifier(node.callee) && allSubNames.has(node.callee.name) && enclosingFn) {
        if (!callers.has(node.callee.name)) callers.set(node.callee.name, new Set());
        callers.get(node.callee.name).add(enclosingFn);
      }
      for (const k of Object.keys(node)) {
        if (SKIP_KEYS.has(k)) continue;
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
      if (SKIP_KEYS.has(k)) continue;
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

// ---- extractInlineFunctions: lift embedded function expressions to top level ----
// Targets: return statement bodies, variable initializers, assignment RHS
// Result: clean return values, readable function names
const _inlineUsedNames = new Set();
function extractInlineFunctions(ast) {
  let count = 0;
  const newFns = []; // collected new function declarations

  function uniqueName(base) {
    if (!_inlineUsedNames.has(base)) { _inlineUsedNames.add(base); return base; }
    let i = 2;
    while (_inlineUsedNames.has(base + "_" + i)) i++;
    const name = base + "_" + i;
    _inlineUsedNames.add(name);
    return name;
  }

  // Collect enclosing scope defs for a function node
  function collectEnclosingDefs(fn) {
    const defs = new Set();
    for (const p of fn.params) { if (t.isIdentifier(p)) defs.add(p.name); }
    if (t.isBlockStatement(fn.body)) {
      for (const s of fn.body.body) {
        if (t.isVariableDeclaration(s)) {
          for (const d of s.declarations) { if (t.isIdentifier(d.id)) defs.add(d.id.name); }
        }
        if (t.isFunctionDeclaration(s) && s.id) defs.add(s.id.name);
      }
    }
    return defs;
  }

  function walk(node, parentArray, stmtIndex, enclosingFnDefs) {
    if (!node || typeof node !== "object") return;

    // Track enclosing function scopes — accumulate defs when entering a function
    let childDefs = enclosingFnDefs;
    if (t.isFunctionDeclaration(node) || t.isFunctionExpression(node) || t.isArrowFunctionExpression(node)) {
      const ownDefs = collectEnclosingDefs(node);
      if (enclosingFnDefs && enclosingFnDefs.size > 0) {
        childDefs = new Set([...enclosingFnDefs, ...ownDefs]);
      } else {
        childDefs = ownDefs;
      }
    }

    // --- Return statement with FunctionExpression/ArrowFunction ---
    if (t.isReturnStatement(node) && node.argument) {
      let fn = findEmbeddedFn(node.argument);
      // Skip 1-statement functions without nested control flow
      if (fn && t.isBlockStatement(fn.body) && fn.body.body.length === 1) {
        const onlyStmt = fn.body.body[0];
        if (!(t.isIfStatement(onlyStmt) || t.isForStatement(onlyStmt) || t.isWhileStatement(onlyStmt) ||
              t.isTryStatement(onlyStmt) || t.isSwitchStatement(onlyStmt) || t.isDoWhileStatement(onlyStmt) ||
              t.isForInStatement(onlyStmt) || t.isForOfStatement(onlyStmt))) {
          fn = null;
        }
      }
      if (fn && t.isBlockStatement(fn.body)) {
        const name = uniqueName(`${SUB_FN_PREFIX}return_${++count}_fn`);
        const fnParamNames = new Set(fn.params.map((p) => (t.isIdentifier(p) ? p.name : null)).filter(Boolean));
        const defined = collectDefined(fn.body.body);
        for (const n of fnParamNames) defined.add(n);
        // Include enclosing scope defs to avoid re-passing available vars
        if (enclosingFnDefs) for (const n of enclosingFnDefs) defined.add(n);
        const extRefs = getExternalRefs(fn.body, defined);
        const allParams = [
          ...fn.params.map((p) => cloneParam(p)),
          ...extRefs.filter((r) => !fnParamNames.has(r)).map((r) => t.identifier(r)),
        ];
        const rfFn = t.functionDeclaration(t.identifier(name), allParams, fn.body);
        if (fn.async) rfFn.async = true;
        if (fn.generator) rfFn.generator = true;
        newFns.push(rfFn);
        replaceFnRef(node, "argument", fn, t.identifier(name));
      }
    }

    // --- Variable declaration init with function ---
    if (t.isVariableDeclaration(node)) {
      for (const decl of node.declarations) {
        if (decl.init && (t.isFunctionExpression(decl.init) || t.isArrowFunctionExpression(decl.init)) &&
            t.isBlockStatement(decl.init.body) && decl.init.body.body.length > 0) {
          // Skip 1-statement functions without nested control flow
          if (decl.init.body.body.length === 1) {
            const onlyStmt = decl.init.body.body[0];
            if (!(t.isIfStatement(onlyStmt) || t.isForStatement(onlyStmt) || t.isWhileStatement(onlyStmt) ||
                  t.isTryStatement(onlyStmt) || t.isSwitchStatement(onlyStmt) || t.isDoWhileStatement(onlyStmt) ||
                  t.isForInStatement(onlyStmt) || t.isForOfStatement(onlyStmt))) {
              continue;
            }
          }
          const varName = t.isIdentifier(decl.id) ? decl.id.name : `var${count}`;
          const name = uniqueName(`${SUB_FN_PREFIX}${varName}_${count}_fn`);
          const fn = decl.init;
          const fnParamNames = new Set(fn.params.map((p) => (t.isIdentifier(p) ? p.name : null)).filter(Boolean));
          const defined = collectDefined(fn.body.body);
          for (const n of fnParamNames) defined.add(n);
          if (enclosingFnDefs) for (const n of enclosingFnDefs) defined.add(n);
          const extRefs = getExternalRefs(fn.body, defined);
          const allParams = [
            ...fn.params.map((p) => cloneParam(p)),
            ...extRefs.filter((r) => !fnParamNames.has(r)).map((r) => t.identifier(r)),
          ];
          const vFn = t.functionDeclaration(t.identifier(name), allParams, fn.body);
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
      if (SKIP_KEYS.has(key)) continue;
      const val = node[key];
      if (Array.isArray(val)) {
        for (let i = 0; i < val.length; i++) {
          if (val[i] && typeof val[i].type === "string") walk(val[i], val, i, childDefs);
        }
      } else if (val && typeof val.type === "string") {
        walk(val, null, -1, childDefs);
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

module.exports = {
  inlineReadOnlyProperties,
  inlinePureWrappers,
  inlineArithmeticWrappers,
  inlineSingleCallerFns,
  extractInlineFunctions,
  resetInlineNames: () => _inlineUsedNames.clear(),
};

// Dead code elimination passes

const { t } = require("../config");
const { SKIP_KEYS } = require("../constants");
const { clone } = require("../ast-utils");

// ---- eliminateDeadCode: remove unreachable statements ----
function eliminateDeadCode(ast) {
  let unreachableRemoved = 0;
  let emptyCatchRemoved = 0;
  let falseBranchRemoved = 0;
  let trueBranchFlattened = 0;
  let emptyBranchRemoved = 0;

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

      // --- if (x) {} [else { B }] → remove or keep else branch ---
      if (t.isIfStatement(s) && t.isBlockStatement(s.consequent) && s.consequent.body.length === 0) {
        if (s.alternate) {
          emptyBranchRemoved++;
          // if (!test) { alternate }
          const newTest = t.unaryExpression("!", clone(s.test));
          const newAlt = t.isBlockStatement(s.alternate) ? s.alternate : t.blockStatement([s.alternate]);
          replacements.push({ array: stmtArray, index: i, count: 1, stmts: [t.ifStatement(newTest, newAlt)] });
        } else {
          emptyBranchRemoved++;
          replacements.push({ array: stmtArray, index: i, count: 1, stmts: [] });
        }
      }
      // --- if (x) { A } else {} → remove else ---
      if (t.isIfStatement(s) && s.alternate && t.isBlockStatement(s.alternate) &&
          s.alternate.body.length === 0 && !t.isIfStatement(s.consequent)) {
        emptyBranchRemoved++;
        const kept = t.isBlockStatement(s.consequent) ? s.consequent.body : [s.consequent];
        replacements.push({ array: stmtArray, index: i, count: 1, stmts: kept });
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
      if (SKIP_KEYS.has(key)) continue;
      const val = node[key];
      if (Array.isArray(val)) { for (const v of val) walkStmtLists(v); }
      else if (val && typeof val.type === "string") walkStmtLists(val);
    }
  }

  // Iterate until stable (one removal might expose another)
  for (let pass = 0; pass < 5; pass++) {
    const before = unreachableRemoved + falseBranchRemoved + trueBranchFlattened + emptyCatchRemoved + emptyBranchRemoved;
    walkStmtLists(ast);
    replacements.reverse().forEach(({ array, index, count, stmts }) => array.splice(index, count, ...stmts));
    replacements.length = 0;
    const after = unreachableRemoved + falseBranchRemoved + trueBranchFlattened + emptyCatchRemoved + emptyBranchRemoved;
    if (after === before) break;
  }

  console.log(`  Removed ${unreachableRemoved} unreachable statements`);
  console.log(`  Removed ${falseBranchRemoved} if(false) branches`);
  console.log(`  Flattened ${trueBranchFlattened} if(true) branches`);
  console.log(`  Removed ${emptyCatchRemoved} empty catch blocks`);
  console.log(`  Removed ${emptyBranchRemoved} empty branch blocks`);
}

// ---- removeUnusedHelpers: delete function declarations that are never referenced ----
// General approach: any function declaration whose name never appears as an Identifier
// (outside its own definition) is dead. Works on any obfuscated codebase.
function removeUnusedHelpers(ast, refGraph) {
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
      if (SKIP_KEYS.has(key)) continue;
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
  let referenced;
  if (refGraph) {
    // Reuse shared refGraph — all identifiers already collected
    referenced = refGraph.referenced;
  } else {
    referenced = new Set();
    function collectRefs(node, parent, parentKey) {
      if (!node || typeof node !== "object") return;

      if (t.isIdentifier(node)) {
        // Skip declaration-site names (function id, variable declarator id)
        const isDeclName = (parent && t.isFunctionDeclaration(parent) && parentKey === "id") ||
                           (parent && t.isVariableDeclarator(parent) && parentKey === "id");
        if (!isDeclName) {
          referenced.add(node.name);
        }
      }

      for (const key of Object.keys(node)) {
        if (SKIP_KEYS.has(key)) continue;
        const val = node[key];
        if (Array.isArray(val)) { for (const v of val) collectRefs(v, node, key); }
        else if (val && typeof val.type === "string") collectRefs(val, node, key);
      }
    }
    collectRefs(ast, null, null);
  }

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

// ---- pushDataToBottom: move DATA-heavy functions to end of file ----
function pushDataToBottom(ast) {
  const stmts = ast.program.body;
  const nonData = [], data = [];
  for (const s of stmts) {
    if (!t.isFunctionDeclaration(s) || !s.id) { nonData.push(s); continue; }
    // Detect DATA-heavy: lines > 400 chars with hex patterns
    let isData = false;
    const code = s.loc ? `${s.loc.start.line}-${s.loc.end.line}` : "";
    function scan(n) {
      if (!n || typeof n !== "object" || isData) return;
      // Large string with hex patterns
      if (t.isStringLiteral(n) && n.value && n.value.length > 400) {
        if (/0x[0-9a-fA-F]{3,}/.test(n.value)) isData = true;
      }
      // Large array of strings (string table)
      if (t.isArrayExpression(n) && n.elements.length > 20 &&
          n.elements.every((e) => t.isStringLiteral(e) || t.isNumericLiteral(e))) isData = true;
      // Large object with string/number entries (hex lookup table)
      if (t.isObjectExpression(n) && n.properties.length > 20 &&
          n.properties.every((p) => t.isStringLiteral(p.key) || t.isIdentifier(p.key) || t.isNumericLiteral(p.key))) isData = true;
      if (t.isFunction(n)) return;
      for (const k of Object.keys(n)) {
        if (k === "start" || k === "end" || k === "loc" ||
            k === "leadingComments" || k === "trailingComments" || k === "innerComments") continue;
        const v = n[k];
        if (Array.isArray(v)) { for (const x of v) scan(x); }
        else if (v && typeof v.type === "string") scan(v);
      }
    }
    scan(s.body);
    if (isData) data.push(s); else nonData.push(s);
  }

  if (data.length === 0) { console.log("  No DATA functions to separate"); return; }

  // Add separator comment to first DATA function
  const firstData = data[0];
  const sepComment = {
    type: "CommentBlock",
    value: ` ${"=".repeat(49)}
 DATA TABLES · ${data.length} function${data.length > 1 ? "s" : ""} · skip unless you need string decoding
${"=".repeat(49)} `
  };
  if (!firstData.leadingComments) firstData.leadingComments = [];
  firstData.leadingComments.unshift(sepComment);

  ast.program.body = [...nonData, ...data];
  console.log(`  Moved ${data.length} DATA functions to bottom`);
}

module.exports = {
  eliminateDeadCode,
  removeUnusedHelpers,
  pushDataToBottom,
};

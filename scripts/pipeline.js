// Main transformation pipeline
// Usage:
//   const { main } = require('./scripts/pipeline');
//   main({ input: 'obfuscated.js', output: 'clean.js' });
//
// Adding a new pass:
//   1. Create your pass function in a module
//   2. Require it here
//   3. Add a step in main() that calls it

const { parser, generate, t, fs } = require("./config");
const path = require("path");
const { DEFAULT_PARSER_OPTS, JSX_PARSER_OPTS, DEFAULT_GENERATE_OPTS, OUTPUT_FILES, SUB_FN_PREFIX, SUB_FN_NAME_RE, isSubFn, SKIP_KEYS } = require("./constants");
const { processAllFunctions } = require("./traverse");
const { extractTopLevelIIFEs } = require("./wrapper");
const { sanitizeReservedWords, hoistDeclarations, simplify, normalizeShortCircuit, expandSequences, eliminateDeadCode, inlineReadOnlyProperties, removeUnusedHelpers, simplifyRedundantConditions, inlinePureWrappers, inlineArithmeticWrappers, sortByCallTree, inlineSingleCallerFns, normalizeSyntax, extractInlineFunctions, annotateAlerts, pushDataToBottom, resetInlineNames, inlineConstObjects } = require("./passes");
const { resetNames } = require("./naming");
const { buildCallGraph } = require("./callgraph");
const { buildRefGraph } = require("./refgraph");
const c = require("./colors");

function main({ input, output, split } = {}) {
  if (!input) throw new Error("main() requires { input: '<path>' }");
  if (!output) throw new Error("main() requires { output: '<path>' }");
  resetNames();
  resetInlineNames();

  console.log("Reading file...");
  const code = fs.readFileSync(input, "utf-8");
  console.log(`Size: ${(code.length / 1024 / 1024).toFixed(2)} MB`);

  console.log("Parsing AST...");
  let ast;
  try {
    ast = parser.parse(code, DEFAULT_PARSER_OPTS);
  } catch (e) {
    console.log("  Standard parse failed, retrying with JSX plugin...");
    ast = parser.parse(code, JSX_PARSER_OPTS);
  }

  // ==================== Sanitization ====================
  console.log(`${c.cyan}Step 0:${c.reset} Sanitizing reserved-word identifiers...`);
  sanitizeReservedWords(ast);

  // ==================== Extraction Passes ====================
  console.log(`${c.cyan}Step 1:${c.reset} Processing all function bodies...`);
  const t0 = Date.now();
  const subFns1 = processAllFunctions(ast);
  console.log(`  ${subFns1.length} sub-functions generated in ${Date.now() - t0}ms`);

  console.log(`${c.cyan}Step 2:${c.reset} Extracting top-level IIFEs from comma chain...`);
  const t1 = Date.now();
  const subFns2 = extractTopLevelIIFEs(ast);
  console.log(`  ${subFns2.length} top-level sub-functions generated in ${Date.now() - t1}ms`);

  // ==================== Append & Organize ====================
  const allSubFns = [...subFns1, ...subFns2];
  console.log(`  Total sub-functions: ${allSubFns.length}`);

  const groups = new Map();
  for (const sf of allSubFns) {
    if (!sf.id) continue;
    const match = sf.id.name.match(/^_S_(.+?)_\d{2}_/);
    const parent = match ? match[1] : "misc";
    if (!groups.has(parent)) groups.set(parent, []);
    groups.get(parent).push(sf);
  }
  for (const g of [...groups.keys()].sort()) {
    for (const sf of groups.get(g)) ast.program.body.push(sf);
  }

  // Build shared graphs (reused by multiple passes)
  const callGraph = buildCallGraph(ast);
  const refGraph = buildRefGraph(ast);

  // ==================== Post-Processing Passes ====================
  console.log(`${c.cyan}Step 3:${c.reset} Hoisting helper function declarations...`);
  const t2 = Date.now();
  hoistDeclarations(ast);
  console.log(`  ${c.dim}Done in ${Date.now() - t2}ms${c.reset}`);

  console.log(`${c.cyan}Step 4:${c.reset} Extracting inline function expressions...`);
  const t3b = Date.now();
  extractInlineFunctions(ast);
  console.log(`  ${c.dim}Done in ${Date.now() - t3b}ms${c.reset}`);

  console.log(`${c.cyan}Step 5:${c.reset} Simplifying expressions (fold+boolean+strings)...`);
  const t3 = Date.now();
  simplify(ast);
  console.log(`  ${c.dim}Done in ${Date.now() - t3}ms${c.reset}`);

  console.log(`${c.cyan}Step 6:${c.reset} Normalizing short-circuit to if blocks...`);
  const t4 = Date.now();
  normalizeShortCircuit(ast);
  console.log(`  ${c.dim}Done in ${Date.now() - t4}ms${c.reset}`);

  console.log(`${c.cyan}Step 7:${c.reset} Expanding sequence expressions...`);
  const t5 = Date.now();
  expandSequences(ast);
  console.log(`  ${c.dim}Done in ${Date.now() - t5}ms${c.reset}`);

  console.log(`${c.cyan}Step 8:${c.reset} Re-normalizing short-circuit after expansion...`);
  const t6 = Date.now();
  normalizeShortCircuit(ast);
  console.log(`  ${c.dim}Done in ${Date.now() - t6}ms${c.reset}`);

  console.log(`${c.cyan}Step 9:${c.reset} Eliminating dead code...`);
  const t9 = Date.now();
  eliminateDeadCode(ast);
  console.log(`  ${c.dim}Done in ${Date.now() - t9}ms${c.reset}`);

  console.log(`${c.cyan}Step 10:${c.reset} Inlining read-only property access...`);
  const t10 = Date.now();
  inlineReadOnlyProperties(ast, refGraph);
  console.log(`  ${c.dim}Done in ${Date.now() - t10}ms${c.reset}`);

  console.log(`${c.cyan}Step 10b:${c.reset} Inlining const object properties...`);
  const t10b = Date.now();
  inlineConstObjects(ast, refGraph);
  console.log(`  ${c.dim}Done in ${Date.now() - t10b}ms${c.reset}`);

  console.log(`${c.cyan}Step 11:${c.reset} Removing unused helper functions...`);
  const t11 = Date.now();
  removeUnusedHelpers(ast, refGraph);
  console.log(`  ${c.dim}Done in ${Date.now() - t11}ms${c.reset}`);

  console.log(`${c.cyan}Step 12:${c.reset} Simplifying redundant conditions...`);
  const t12 = Date.now();
  simplifyRedundantConditions(ast);
  console.log(`  ${c.dim}Done in ${Date.now() - t12}ms${c.reset}`);

  console.log(`${c.cyan}Step 13:${c.reset} Inlining pure wrapper functions...`);
  const t13 = Date.now();
  inlinePureWrappers(ast);
  console.log(`  ${c.dim}Done in ${Date.now() - t13}ms${c.reset}`);

  // Step 13b: disabled — too slow on large files (142KB+), needs optimization
  // console.log("Step 13b: Inlining arithmetic wrappers...");
  // inlineArithmeticWrappers(ast);

  console.log(`${c.cyan}Step 14:${c.reset} Sorting functions by call tree...`);
  const t14 = Date.now();
  sortByCallTree(ast, callGraph);
  console.log(`  ${c.dim}Done in ${Date.now() - t14}ms${c.reset}`);

  console.log(`${c.cyan}Step 15:${c.reset} Inlining single-caller functions...`);
  const t15 = Date.now();
  inlineSingleCallerFns(ast, callGraph);
  console.log(`  ${c.dim}Done in ${Date.now() - t15}ms${c.reset}`);

  console.log(`${c.cyan}Step 16:${c.reset} Normalizing syntax patterns...`);
  const t16 = Date.now();
  normalizeSyntax(ast);
  console.log(`  ${c.dim}Done in ${Date.now() - t16}ms${c.reset}`);

  console.log(`${c.cyan}Step 17:${c.reset} Re-extracting exposed inline functions...`);
  const t17 = Date.now();
  extractInlineFunctions(ast);
  console.log(`  ${c.dim}Done in ${Date.now() - t17}ms${c.reset}`);

  console.log(`${c.cyan}Step 18:${c.reset} Annotating functions with security alerts...`);
  const t18 = Date.now();
  annotateAlerts(ast, callGraph, refGraph);
  console.log(`  ${c.dim}Done in ${Date.now() - t18}ms${c.reset}`);

  // ==================== Final Sanitization ====================
  console.log(`${c.cyan}Step 19:${c.reset} Sanitizing reserved-word identifiers...`);
  sanitizeReservedWords(ast);

  console.log(`${c.cyan}Step 20:${c.reset} Separating DATA functions...`);
  pushDataToBottom(ast);

  // ==================== Output ====================
  if (split) {
    writeSplitOutput(ast, output, code);
    return null;
  } else {
    return writeSingleOutput(ast, output, code);
  }
}

function writeSingleOutput(ast, output, code) {
  // output is always a directory; write deobfuscated code as main.js inside it
  const outDir = output;
  if (fs.existsSync(outDir)) fs.rmSync(outDir, { recursive: true });
  fs.mkdirSync(outDir, { recursive: true });

  // Safety: filter out any non-statement nodes from program body
  ast.program.body = ast.program.body.filter((n) => n && typeof n.type === "string" && n.type !== "CommentLine" && n.type !== "CommentBlock");

  const generated = generate(ast, DEFAULT_GENERATE_OPTS).code;

  const mainFile = path.join(outDir, OUTPUT_FILES.MAIN);
  fs.writeFileSync(mainFile, generated, "utf-8");

  const finalSize = fs.statSync(mainFile).size;
  const ratio = ((finalSize / code.length) * 100).toFixed(1);
  console.log(`${c.green}Done!${c.reset} Output: ${(finalSize / 1024 / 1024).toFixed(2)} MB (${ratio}% of original)`);

  const fnCount = fs.readFileSync(mainFile, "utf-8").split("\n").filter((l) => l.includes(`function ${SUB_FN_PREFIX}`)).length;
  console.log(`${SUB_FN_PREFIX} function declarations in output: ${c.bold}${fnCount}${c.reset}`);
  return generated;
}

function writeSplitOutput(ast, output, code) {
  console.log("Splitting into per-function files...");

  // Ensure output directory
  const outDir = output;
  if (fs.existsSync(outDir)) fs.rmSync(outDir, { recursive: true });
  fs.mkdirSync(outDir, { recursive: true });

  // Group _S_ functions by parent name
  const groups = new Map();
  const otherStmts = [];

  for (const stmt of ast.program.body) {
    if (t.isFunctionDeclaration(stmt) && stmt.id && isSubFn(stmt.id.name)) {
      const match = stmt.id.name.match(SUB_FN_NAME_RE);
      const parent = match ? match[1] : "misc";
      if (!groups.has(parent)) groups.set(parent, []);
      groups.get(parent).push(stmt);
    } else {
      otherStmts.push(stmt);
    }
  }

  // --- Phase 1: generate ALL function codes at once ---
  // Write main.js with full combined output (used by reports)
  fs.writeFileSync(path.join(outDir, "main.js"), generate(ast, {
    retainLines: false, retainFunctionParens: false,
    comments: true, compact: false,
  }).code, "utf-8");

  // Generate each function separately but without prettier — batch format at end
  const generatedFns = new Map();

  // Generate each _S_ function
  for (const stmt of ast.program.body) {
    if (t.isFunctionDeclaration(stmt) && stmt.id && stmt.id.name.startsWith("_S_")) {
      const fnAst = { ...ast, program: { ...ast.program, body: [stmt] } };
      generatedFns.set(stmt, generate(fnAst, {
        ...DEFAULT_GENERATE_OPTS,
      }).code);
    }
  }

  // --- Phase 2: write files ---
  let totalFiles = 1; // main.js
  let processed = 0;
  const groupEntries = [...groups.entries()];
  const barWidth = 30;

  for (const [parentName, fns] of groupEntries) {
    const dir = path.join(outDir, parentName);
    fs.mkdirSync(dir, { recursive: true });

    const exports = fns.map((fn) => `  "${fn.id.name}": require("./${fn.id.name}"),`).join("\n");
    fs.writeFileSync(path.join(dir, "index.js"), `// Group: ${parentName} (${fns.length} functions)\nmodule.exports = {\n${exports}\n};\n`, "utf-8");
    totalFiles++;

    for (const fn of fns) {
      let fnCode = generatedFns.get(fn) || "";

      // Add require() calls for external sub-function references
      const imports = new Set();
      walkCalls(fn.body, imports);
      const importLines = [];
      for (const name of imports) {
        if (isSubFn(name)) {
          const match = name.match(SUB_FN_NAME_RE);
          const parent = match ? match[1] : "misc";
          importLines.push(`const ${name} = require("../${parent}/${name}");`);
        }
      }
      if (importLines.length > 0) fnCode = importLines.join("\n") + "\n\n" + fnCode;

      fs.writeFileSync(path.join(dir, `${fn.id.name}.js`), fnCode, "utf-8");
      totalFiles++;
    }

    processed++;
    const pct = Math.round((processed / groupEntries.length) * 100);
    const filled = Math.round((processed / groupEntries.length) * barWidth);
    process.stdout.write(`\r  [${"█".repeat(filled)}${"░".repeat(barWidth - filled)}] ${pct}%  ${processed}/${groupEntries.length} groups`);
  }
  process.stdout.write("\n");

  // Assembly index
  const rootEntries = [...groups.keys()].map((g) => `  "${g}": require("./${g}"),`).join("\n");
  fs.writeFileSync(path.join(outDir, "index.js"), `// Assembly\nmodule.exports = {\n${rootEntries}\n};\n`, "utf-8");


  console.log(`  Wrote ${totalFiles} files to ${outDir}/ (${groups.size} groups)`);
}

function walkCalls(node, collected) {
  if (!node || typeof node !== "object") return;
  if (t.isCallExpression(node) && t.isIdentifier(node.callee) && isSubFn(node.callee.name)) {
    collected.add(node.callee.name);
  }
  for (const k of Object.keys(node)) {
    if (SKIP_KEYS.has(k)) continue;
    const val = node[k];
    if (Array.isArray(val)) { for (const v of val) walkCalls(v, collected); }
    else if (val && typeof val.type === "string") walkCalls(val, collected);
  }
}

module.exports = { main };

# deob — Universal JS Deobfuscation Pipeline

## Quick Start

```bash
deob init                        # create deob.config.js
deob                             # auto-detect deob.config.js
deob -c path/to/config.js        # explicit config
```

## Project Structure

```
deob.js                          CLI entry, config parsing, directory recursion
scripts/
  config.js                      Shared: parser, t, generate, fs, path, GLOBALS, RESERVED, ALERT_PATTERNS, DEFAULT_DENOISE
  ast-utils.js                   Generic AST walkers, pattern detectors, clone
  scope.js                       Variable scope analysis
  naming.js                      Sub-function naming (_S_ prefix)
  emit.js                        Sub-function AST node creation
  extract.js                     Syntactic extraction (IIFE, try/catch, loop, if/else, switch)
  traverse.js                    Innermost-first function collection
  wrapper.js                     Top-level IIFE extraction from comma chains
  pipeline.js                    20-step pipeline orchestration
  passes/
    simplify.js                  Constant folding, boolean, string, short-circuit, syntax normalization
    dead-code.js                 Dead code elimination, unused helper removal, DATA separation
    inline.js                    Property inlining, wrapper inlining, single-caller inlining
    declarations.js              Hoisting, reserved-word sanitization, alert annotation, call-tree sorting
    index.js                     Re-exports all pass modules
  structure/
    analyze.js                   AST analysis, domain classification, function categorization
    report.js                    Markdown/prompt generation
    index-gen.js                 Compact index.txt generation
    tier.js                      Tier filtering (1=alerts, 2=+callees, 3=all)
    cross-file.js                Multi-file summary and cross-readme
    index.js                     Re-exports all structure modules
  metrics.js                     Before/after readability metrics
  index.js                       Public API re-export
```

## Architecture

```
deob.config.js → deob.js → pipeline.main() → 20 sequential passes → generate → write
                             ↓
                     structure.analyzeStructure()  ← cached, called 1-3x per file
                             ↓
                     report / index-gen / tier / cross-file
```

## Code Conventions

### Naming

| Kind | Style | Example |
|------|-------|---------|
| Functions | `camelCase`, verb-first | `walkAST`, `inlinePureWrappers`, `detectJumpTable` |
| Constants | `UPPER_SNAKE_CASE` | `RESERVED`, `GLOBALS`, `ALERT_PATTERNS`, `DEFAULT_DENOISE` |
| Variables | `camelCase`, short | `fns`, `stmts`, `exprs`, `count`, `i`, `k`, `v` |
| Private state | `_` prefix | `_analysisCache`, `_inlineUsedNames` |
| AST sentinels | `$$` prefix | `$$refW` |

### Module Pattern

Every file follows this order:
1. **Imports** — `const { x } = require("../module")` at top
2. **Section headers** — `// ---- Section Title ----` before each group
3. **Functions** — one per logical concern
4. **Exports** — single `module.exports = { ... }` at bottom

```js
// ---- Description of this module ----

const { t } = require("../config");
const { clone } = require("../ast-utils");

// ---- Function Group ----

function myFunction(ast) {
  // ...
}

module.exports = { myFunction };
```

### Index Re-exports

Index files use spread to re-export all symbols:
```js
const sub = require("./sub");
module.exports = { ...sub };
```

When a sub-module exports a non-function (arrow, Set), list it explicitly:
```js
module.exports = { ...sub, resetNames: sub.resetNames };
```

### Pass Signature

Every pass function:
- Takes a single `ast` parameter (Babel AST root)
- Mutates the AST in place
- Returns `void`
- Logs results with 2-space indent: `console.log("  Verb count noun")`

```js
function myPass(ast) {
  let count = 0;
  // ... transform logic ...
  console.log(`  Transformed ${count} nodes`);
}
```

### AST Walking

Use the canonical pattern for all AST walks:
```js
function walk(node) {
  if (!node || typeof node !== "object") return;
  // ... node-specific logic ...
  for (const key of Object.keys(node)) {
    if (key === "start" || key === "end" || key === "loc" ||
        key === "leadingComments" || key === "trailingComments" || key === "innerComments") continue;
    const val = node[key];
    if (Array.isArray(val)) { for (const v of val) walk(v); }
    else if (val && typeof val.type === "string") walk(v);
  }
}
```

For transforms that replace nodes, return the (possibly replaced) node:
```js
function walk(node) {
  if (!node || typeof node !== "object") return node;
  // ... pattern checks that return replacement nodes ...
  for (const key of Object.keys(node)) {
    // ...skip keys...
    const val = node[key];
    if (Array.isArray(val)) {
      for (let i = 0; i < val.length; i++) val[i] = walk(val[i]);
    } else if (val && typeof val.type === "string") {
      node[key] = walk(val);
    }
  }
  return node;
}
```

### Alert Patterns

Defined in `config.js` as `ALERT_PATTERNS`:
```js
{ label: "Name", regex: /\b...\b/gi, severity: "critical"|"high"|"medium"|"low"|"info" }
```

Denoise rules in `DEFAULT_DENOISE`:
```js
{ match: "regex-source-string", label: "New Label", severity: "low" }
```

Severity levels: `critical` > `high` > `medium` > `low` > `info`

### Error Handling

- **Parse errors**: try/catch with fallback to regex-based analysis
- **File errors in batch**: try/catch, log SKIPPED, continue
- **File errors in single mode**: try/catch, log ERROR, exit(1)
- **Invalid config**: `console.error` + `process.exit(1)`
- **No custom Error classes** — use plain Error objects

### Logging

- Pass results: `console.log("  Verb count noun")` — 2-space indent
- Pipeline steps: `console.log("Step N: Description...")` — numbered
- Timing: `const t = Date.now(); ... console.log("  Done in ${Date.now()-t}ms")`
- Errors: `console.error(...)` — no log levels, no framework

### Comments

```js
// ---- Section Title ----              ← top-level section divider
// --- Pattern Description ---           ← inline pattern label within a walk
// ==================== Phase Name ===   ← pipeline phase divider
// Disabled code description             ← commented-out code with reason
```

## Adding a New Pass

1. Create function in appropriate `scripts/passes/*.js` file
2. Follow pass signature: `function myPass(ast) { ... console.log(...) }`
3. Add to `module.exports` in that file
4. Add step in `pipeline.js` between existing steps
5. Test with a sample file
6. Commit with message: `feat: description of what the pass does`

## Adding a New Alert Pattern

1. Add to `ALERT_PATTERNS` in `config.js`
2. Use `/\b...\b/gi` format with non-capturing groups
3. Choose severity: critical/high/medium/low/info
4. Both `annotateAlerts` (passes) and `analyzeStructure` (reports) will pick it up

## Adding a New Domain Classification

1. Add regex check in `classifyDomain` in `structure/analyze.js`
2. Place before generic checks (framework detection before "Browser DOM")
3. Use specific patterns, not broad matches
4. Test against multiple sites to avoid overfitting

## Anti-Overfitting Rules

1. Every optimization must be **general-purpose**, not tailored to one test file
2. Test against all existing samples after each change
3. Prefer regex patterns over hardcoded values
4. Prefer AST patterns over string matching
5. Document the **why** behind each pattern, not just the **what**

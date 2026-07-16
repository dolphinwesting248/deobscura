# deob Code Standards

This document defines the coding conventions for the deob project. All new code must follow these standards.

## 1. Language & Runtime

- **JavaScript** (CommonJS modules) — no TypeScript, no ES modules
- **Node.js** runtime — no browser compatibility requirements
- **No transpilation** — use Node.js 18+ features directly

## 2. Module System

### Imports

```js
// ✅ Correct — destructured, at top of file
const { t, RESERVED } = require("../config");
const { clone, walkAST } = require("../ast-utils");

// ✅ Correct — full module when all exports needed
const parser = require("@babel/parser");

// ❌ Wrong — default import syntax
import { t } from "../config";
```

### Exports

```js
// ✅ Correct — single module.exports at bottom
module.exports = { fn1, fn2, fn3 };

// ❌ Wrong — multiple export statements
exports.fn1 = fn1;
exports.fn2 = fn2;
```

### Index Files

```js
// ✅ Correct — spread re-export
const sub1 = require("./sub1");
const sub2 = require("./sub2");
module.exports = { ...sub1, ...sub2 };

// ✅ Correct — explicit re-export for non-function values
module.exports = { ...sub1, resetNames: sub1.resetNames };
```

## 3. Naming

| Kind | Convention | Example |
|------|-----------|---------|
| Functions | `camelCase`, verb-first | `walkAST`, `inlinePureWrappers` |
| Constants | `UPPER_SNAKE_CASE` | `RESERVED`, `ALERT_PATTERNS` |
| Variables | `camelCase`, concise | `fns`, `stmts`, `count`, `i` |
| Private state | `_` prefix | `_analysisCache`, `_inlineUsedNames` |
| AST sentinels | `$$` prefix | `$$refW` |
| Booleans | `is/has/can` prefix | `isData`, `hasReturn`, `canInline` |

### Function Naming Patterns

```
detectX(body)         ← detect pattern, return boolean
collectX(node)        ← walk AST, collect into array
inlineX(ast)          ← transform AST in place
generateX(report)     ← produce output string
classifyX(filepath)   ← categorize, return label
computeX(data)        ← calculate numeric value
```

## 4. File Structure

Every file must follow this order:

```
1. Module doc comment (optional, for complex modules)
2. Imports (const ... require)
3. Section headers (// ---- Title ----)
4. Function definitions
5. module.exports at bottom
```

```js
// ---- Module purpose ----

const { t } = require("../config");

// ---- First function group ----

function fn1(ast) { ... }
function fn2(ast) { ... }

// ---- Second function group ----

function fn3(ast) { ... }

module.exports = { fn1, fn2, fn3 };
```

## 5. Pass Functions

### Signature

```js
function myPass(ast) {
  let count = 0;
  // ... transform logic ...
  console.log(`  Transformed ${count} nodes`);
}
```

- Single `ast` parameter (Babel AST root)
- Mutate AST in place, return `void`
- Log results with 2-space indent

### Adding a New Pass

1. Create function in `scripts/passes/<category>.js`
2. Add to that file's `module.exports`
3. Add step in `pipeline.js`:
   ```js
   console.log("Step N: Description...");
   const tN = Date.now();
   myPass(ast);
   console.log(`  Done in ${Date.now() - tN}ms`);
   ```
4. Test with sample file
5. Commit: `feat: myPass — what it does and why`

## 6. AST Walking

### Standard Walk (read-only)

```js
function walk(node) {
  if (!node || typeof node !== "object") return;
  // ... process node ...
  for (const key of Object.keys(node)) {
    if (key === "start" || key === "end" || key === "loc" ||
        key === "leadingComments" || key === "trailingComments" || key === "innerComments") continue;
    const val = node[key];
    if (Array.isArray(val)) { for (const v of val) walk(v); }
    else if (val && typeof val.type === "string") walk(v);
  }
}
```

### Transform Walk (replaces nodes)

```js
function walk(node) {
  if (!node || typeof node !== "object") return node;
  // ... pattern checks returning replacement nodes ...
  for (const key of Object.keys(node)) {
    if (key === "start" || key === "end" || key === "loc" ||
        key === "leadingComments" || key === "trailingComments" || key === "innerComments") continue;
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

### Key Rules

- Always skip: `start`, `end`, `loc`, `leadingComments`, `trailingComments`, `innerComments`
- Always check: `Array.isArray(val)` before iterating, `typeof val.type === "string"` before recursing
- Always guard: `if (!node || typeof node !== "object") return` at top
- Use `t.isFunction(node)` to stop at function boundaries when needed

## 7. Pattern Detection

### ALERT_PATTERNS (config.js)

```js
{ label: "Name", regex: /\b(?:alt1|alt2)\b/gi, severity: "high" }
```

- Use `\b` word boundaries
- Use `(?:...)` non-capturing groups for alternations
- Use `gi` flags (global + case-insensitive)
- Severity: `critical` > `high` > `medium` > `low` > `info`

### Denoise Rules (config.js)

```js
{ match: "regex-source", label: "Label", severity: "low" }
```

- `match` is a regex source string (not RegExp object)
- Compiled at runtime: `new RegExp(rule.match, "i")`

## 8. Error Handling

| Context | Strategy |
|---------|----------|
| Parse errors | try/catch → fallback to regex analysis |
| File errors (batch) | try/catch → log SKIPPED, continue |
| File errors (single) | try/catch → log ERROR, exit(1) |
| Invalid config | `console.error` + `process.exit(1)` |
| Invalid regex in denoise | silently skip |

No custom Error classes. Use plain `Error` objects.

## 9. Comments

```js
// ---- Section Title ----              ← top-level section divider
// --- Pattern Description ---           ← inline pattern label
// ==================== Phase Name ===   ← pipeline phase divider
// Reason for disabling                  ← commented-out code
```

- Section headers: `// ---- Title ----` with dashes
- Inline patterns: `// --- description ---` within walks
- Disabled code: always include reason
- No JSDoc — keep comments minimal and focused

## 10. Logging

```js
// Pass results — 2-space indent
console.log(`  Transformed ${count} nodes`);

// Pipeline steps — numbered
console.log("Step N: Description...");

// Timing
const t = Date.now();
// ... work ...
console.log(`  Done in ${Date.now() - t}ms`);

// Errors
console.error(`  SKIPPED: ${message}`);
```

No logging framework. No log levels. Just `console.log` and `console.error`.

## 11. Performance

- Use `Map` and `Set` for lookups, not `Array.includes()` or `Array.find()`
- Cache expensive computations (e.g., `analyzeStructure` result)
- Use iterative walks for large files (>100KB) to avoid stack overflow
- Profile with `Date.now()` timing in pipeline steps

## 12. Anti-Overfitting

1. Every optimization must be **general-purpose**
2. Test against **all** existing samples after each change
3. Prefer **regex patterns** over hardcoded values
4. Prefer **AST patterns** over string matching
5. Document the **why** behind each pattern
6. Never optimize for a single test file
7. If a fix only helps one file, it's not worth merging

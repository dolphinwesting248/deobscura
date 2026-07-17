# deobscura

AST-based JavaScript deobfuscation framework, purpose-built as a **data preprocessing tool for LLM-driven reverse engineering**.

- **Universal.** No obfuscator detection, no signature matching.
- **LLM-oriented.** Structure reports, call graphs, alerts, function catalog — output designed for LLM consumption.

## Quick Start

```bash
npm i deobscura -g
deob init                        # create deob.config.js
deob                             # run with config
deob -c path/to/config.js        # explicit config
```

## Configuration

`deob.config.js`:

```js
module.exports = {
  input: "src/main.js",           // file, directory, or array
  output: "out/",                 // optional, auto-derived
  split: false,                   // per-function file output
  metrics: false,                 // HTML readability report
  md: true,                       // 0-prompt.md + 1-structure.md
  index: true,                    // 2-index.txt
  agent: false,                   // LLM agent mode: compact, minimal banners
  tier: 3,                        // 1=alerts+hotspots, 2=+callees, 3=all
  fold: true,                     // collapse mechanical functions to comments
  banner: true,                   // true=verbose, false=minimal metadata
  compact: false,                 // compact code generation
  denoise: [                      // alert denoising rules (optional)
    { match: "regex-source", label: "Label", severity: "low" },
  ],
};
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `input` | `string \| string[]` | required | JS file(s) or directory |
| `output` | `string` | auto | Output directory |
| `split` | `boolean` | `false` | Write each function to separate file |
| `metrics` | `boolean` | `false` | Generate HTML before/after report |
| `md` | `boolean` | `true` | Generate 0-prompt.md + 1-structure.md |
| `index` | `boolean` | `true` | Generate 2-index.txt |
| `agent` | `boolean` | `false` | LLM agent mode: compact output, minimal banners, auto fold+tier |
| `tier` | `1 \| 2 \| 3` | `3` | Output filtering level |
| `fold` | `boolean` | `true` | Collapse mechanical functions to comments (works at all tiers) |
| `banner` | `boolean` | `true` | true=verbose metadata banner, false=minimal (name + alerts) |
| `compact` | `boolean` | `false` | Compact code generation (less whitespace) |
| `denoise` | `DenoiseRule[]` | defaults | Alert denoising rules |

See [tier-and-fold.md](./docs/tier-and-fold.md) for more details for `tier` and `fold`.

See [denoise.md](./docs/denoise.md) for more details for `denoise`.

## Output Files

```
output.deob/
  0-prompt.md       ← LLM entry: architecture, alerts, top 5, reading path
  1-structure.md    ← call graph, hotspots, alert traces, naming convention
  2-index.txt       ← function catalog: legend, categories, shared vars, closures
  main.js           ← deobfuscated code with metadata banners on _S_ functions
  summary.md        ← (directory mode) cross-file legend and keyword index
```

### 0-prompt.md

```
## Architecture         — function count, domain, complexity, code density, closure captures
## Alerts               — security-relevant patterns found
## Start Here (top 5)   — most interesting functions with banner-style inline info
## Skip                 — pass-through functions
## Reading Path         — prompt → structure → index → main.js
```

### 1-structure.md

```
## Domain               — framework/bundler/crypto/network classification (top 3 by weight)
## Hotspots             — most-called functions, entry points, leaves
## Alerts               — security patterns with severity, function, trace
## Call Graph           — Mermaid diagram of cross-function calls
## Naming Convention    — _S_<parent>_<seq>_<hint> format explanation
```

### 2-index.txt

```
## Legend               — Ss/Pp, cc=, →/⇐, root, closure:, paramRoles, [semTags], FLAT, DATA
## entry                — entry point functions
## alerts               — security patterns with function and matches
## hot                  — most-called functions
## shared               — variables used by 2+ functions
## trace                — longest call path
## suspicious / flat    — suspicious and control-flow-flattened functions
## fn/<category>        — functions grouped by category with labels
```

## Pipeline Steps

| Step | Pass | Module | Description |
|------|------|--------|-------------|
| 0 | `sanitizeReservedWords` | declarations.js | Rename reserved-word identifiers |
| 1 | `processAllFunctions` | traverse.js | Collect all function nodes, process innermost-first |
| 2 | `extractTopLevelIIFEs` | wrapper.js | Extract top-level IIFEs from comma chains |
| — | `buildCallGraph` | callgraph.js | Build shared forward/reverse call edges (step 14 & 15) |
| — | `buildRefGraph` | refgraph.js | Build shared declaration/mutation/reference graph (step 10/10b/11) |
| 3 | `hoistDeclarations` | declarations.js | Import→top, export→bottom; var/let/const/fn to top |
| 4 | `extractInlineFunctions` | inline.js | Lift embedded function expressions to top level |
| 5 | `simplify` | simplify.js | Constant folding + boolean + string + hex normalization |
| 6 | `normalizeShortCircuit` | simplify.js | Convert `A \|\| B` to `if (!A) { B }` |
| 7 | `expandSequences` | simplify.js | Break comma chains into independent statements |
| 8 | `normalizeShortCircuit` | simplify.js | Re-normalize after expansion |
| 9 | `eliminateDeadCode` | dead-code.js | Remove unreachable statements, `if(false)`, empty branches |
| 10 | `inlineReadOnlyProperties` | inline.js | Replace `cfg.PROP` with literal value (all scopes, per-property mutation check) |
| 10b | `inlineConstObjects` | simplify.js | Replace `cfg.timeout` with `5000` (all scopes) |
| 11 | `removeUnusedHelpers` | dead-code.js | Delete unreferenced function declarations (`_0x` + unique dead names) |
| 12 | `simplifyRedundantConditions` | simplify.js | `if(a)return true;return false`→`return !!a`, if-return→ternary, negated-tests |
| 13 | `inlinePureWrappers` | inline.js | Inline `return call(args)`, `.apply(this,args)`, `.call(this,...)` bridges |
| 13b | `inlineArithmeticWrappers` | inline.js | Collapse `function(a,b){return a+b}` at call sites |
| 14 | `sortByCallTree` | declarations.js | Topological sort: callees before callers |
| 15 | `inlineSingleCallerFns` | inline.js | Inline functions called from exactly one place |
| 16 | `normalizeSyntax` | simplify.js | `~arr.indexOf`→`arr.includes`, reversed typeof, multi-decl split (non-trivial only) |
| 17 | `extractInlineFunctions` | inline.js | Re-extract with enclosing scope defs, skip 1-stmt without control flow |
| 18 | `annotateAlerts` | declarations.js | Inject alerts + metadata banners on `_S_` functions |
| 19 | `sanitizeReservedWords` | declarations.js | Re-sanitize reserved-word identifiers |
| 20 | `pushDataToBottom` | dead-code.js | Move DATA-heavy functions to end with separator |

## Output Examples

### Comma operator expansion + inline function extraction

```javascript
// Input
function a0_0x5465(_0x147aca,_0x1c469e){var _0x477d9d=a0_0x1cb6();return (a0_0x5465=function(_0x593f2d,_0x4d5e1e){var _0x2a8c=_0x477d9d[_0x593f2d];return _0x2a8c?_0x2a8c(_0x4d5e1e,_0x147aca):_0x4d5e1e}),a0_0x5465(_0x147aca,_0x1c469e)}

// Output
function a0_0x5465(_0x147aca, _0x1c469e) {
  var _0x477d9d = a0_0x1cb6();
  a0_0x5465 = _S_return_1_fn;
  return a0_0x5465(_0x147aca, _0x1c469e);
}
function _S_return_1_fn(_0x593f2d, _0x4d5e1e, _0x477d9d, _0x147aca) {
  var _0x2a8c = _0x477d9d[_0x593f2d];
  return _0x2a8c ? _0x2a8c(_0x4d5e1e, _0x147aca) : _0x4d5e1e;
}
```

### Short-circuit to if block

```javascript
// Input
"undefined"==typeof Element||Element.prototype.addEventListener||(u=[],Ao=function(n,t){...})

// Output
if ("undefined" != typeof Element && !Element.prototype.addEventListener) {
  u = [];
  Ao = function (n, t) { ... };
}
```

### Control-flow flattened code

Deob extracts each `switch` / `case` / `try` / `catch` / loop body as a named sub-function, exposing the dispatcher structure.

## API

```javascript
const { main } = require("./scripts");
main({ input: "obfuscated.js", output: "out/", split: true });
```

## License

ISC

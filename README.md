# deob

Deob is a general-purpose JavaScript deobfuscation preprocessing framework based on AST, designed as a **data-preparation step for LLM-assisted reverse engineering**.

- **Universal.** No obfuscator detection, no signature matching. obfuscator.io, JSVMP, webpack bundles, custom obfuscators — all treated the same.
- **LLM-oriented.** Structure reports, call graphs, string alerts, compact index, function categorization — output designed for LLM consumption, not just human readability.

## Quick Start

```bash
npm install
npm link

deob init                    # create deob.config.js
# edit deob.config.js — set input path and options
deob                         # run with config
deob --config other.js       # or: deob -c other.js
```

All output goes into a directory:

```
output.deob/
├── main.js           ← deobfuscated code
├── metrics.html      ← readability report (metrics: true)
├── structure.md      ← function analysis + hotspots + alerts (md: true)
└── index.txt         ← compact function catalog for LLM navigation (index: true)
```

**Directory input** recursively processes nested subdirectories. Source paths are preserved in the cross-file `summary.md`.

Run `deob init` to generate a template:

```javascript
module.exports = {
  input: "src/main.js",             // file, directory, or array
  // output: "out/",                // optional — auto-derived from input
  split: false,                     // per-function files
  metrics: false,                   // HTML readability report
  md: true,                         // Markdown structure report
  index: false,                     // compact index.txt for LLM navigation
  tier: 3,                          // output filtering: 1|2|3
  fold: false,                      // collapse mechanical functions
};
```

See [Tiered Output](docs/tier-and-fold.md) for detailed guidance on `tier` and `fold`.

## Structure Report (`structure.md`)

| Section | Content |
|---------|---------|
| TL;DR | One-line summary: *"847 functions · 12 high alerts · 5 flattened · 2 entry points"* |
| Summary | Domain classification, code density, total/sub-fns/original/complexity/flattened/suspicious counts |
| Hotspots + Trace | Most-called functions, root entry points, leaf terminals, suggested trace path |
| String Alerts | Security-relevant patterns with severity, function, line number, and entry→alert trace |
| Hot Groups | Groups with most cross-function call edges |
| Call Graph | Mermaid diagram of cross-function calls (suppressed when no edges exist) |
| Naming Convention | Reference for `_sub_<parent>_<seq>_<description>` format and hint suffixes |

## Compact Index (`index.txt`)

A token-optimized function catalog in custom text format, designed for LLM consumption. Contains:

| Section | Content |
|---------|---------|
| `entry` | Entry point functions with calls and flags |
| `alerts` | Alert-annotated functions with matched patterns |
| `hot` | Most-called functions ranked by incoming edges |
| `lookup` | Word → function mapping (semantic keywords only) |
| `trace` | Longest call path through the graph |
| `suspicious` | Functions with suspicious patterns (eval, computed key, \__proto__) |
| `flat` | Functions with control-flow flattening |
| `fn/*` | All functions grouped by category (core / branch / callback / data / network / crypto / parser / i18n / websocket / polyfill / filesystem / other) |

Each `fn/*` entry includes: size triplets (`lines/stmts/params`), semantic tags, function descriptions, and flags (`DATA`, `FLAT`).

## Pipeline 

| Step | Pass | Description |
|------|------|-------------|
| 0 | `sanitize` | Rename reserved-word identifiers (let, default, delete…) to safe alternatives |
| 1 | `traverse` | Collect all function nodes, process innermost-first |
| 2 | `wrapper` | Extract top-level IIFEs from comma chains |
| 3 | `hoist` | Import→top, export→bottom; var/let/const/fn to top of every scope |
| 4 | `extract-inline` | Lift embedded function expressions (return, assignment, IIFE, MemberExpression) |
| 5 | `simplify` | Fold constants, simplify booleans, fold string ops, normalize AST |
| 6 | `short-circuit` | Convert `A\|\|B\|\|(C,D)` → `if(!A&&!B){C;D;}`, ternary → if/else, `var x=cond?a:b` → if/else |
| 7 | `expand-seq` | Break comma chains into independent statements |
| 8 | `short-circuit` | Second pass — catch LogicalExpressions exposed by comma splitting |
| 9 | `dead-code` | Remove if(false), unreachable code after return, empty catch |
| 10 | `inline-props` | Replace config.PROP with literal values |
| 11 | `unused` | Remove helper functions never referenced |
| 12 | `conditions` | Simplify `a?true:false→!!a`, if/return patterns |
| 13 | `wrappers` | Inline pure wrapper functions |
| 14 | `call-tree` | Topological sort: callees before callers |
| 15 | `single-caller` | Inline functions called from exactly one place |
| 16 | `normalize` | Multi-decl split, chained assignment split, for(;;)→while(true) |
| 17 | `extract-inline` | Second pass — catch patterns exposed by restructuring |
| 18 | `annotate` | Inject `[API Endpoint]`, `[Token/Key]`, `[Crypto]` etc. comments before functions |
| 19 | `sanitize` | Final pass — catch any reserved-word identifiers introduced by pipeline |

## Tiered Output

The `tier` and `fold` options control how much code reaches the LLM. See **[docs/tier-and-fold.md](docs/tier-and-fold.md)** for detailed guidance, behavior matrix, and best practices.

Quick reference:

| Config | What the LLM sees |
|--------|-------------------|
| `tier: 3` | All functions, full code |
| `tier: 1` | Signal functions (alerts, hotspots, flattening, suspicious) full code. Rest: signatures only. |
| `tier: 1, fold: true` | Same + mechanical functions (polyfill/pure-compute/forward) collapsed to comments. |
| `tier: 2` | Signal functions + callees full code. Rest: signatures. |
| `tier: 2, fold: true` | Same + mechanical functions collapsed. |

## Output Examples

### Comma operator expansion + inline function extraction

```javascript
// Input
function a0_0x5465(_0x147aca,_0x1c469e){var _0x477d9d=a0_0x1cb6();return (a0_0x5465=function(_0x593f2d,_0x4d5e1e){var _0x2a8c=_0x477d9d[_0x593f2d];return _0x2a8c?_0x2a8c(_0x4d5e1e,_0x147aca):_0x4d5e1e}),a0_0x5465(_0x147aca,_0x1c469e)}

// Output
function a0_0x5465(_0x147aca, _0x1c469e) {
  var _0x477d9d = a0_0x1cb6();
  a0_0x5465 = _sub_return_fn1;
  return a0_0x5465(_0x147aca, _0x1c469e);
}
function _sub_return_fn1(_0x593f2d, _0x4d5e1e, _0x477d9d, _0x147aca) {
  var _0x2a8c = _0x477d9d[_0x593f2d];
  return _0x2a8c ? _0x2a8c(_0x4d5e1e, _0x147aca) : _0x4d5e1e;
}
```

↑ `return (a=fn, b)` → two statements; inline `function` lifted to `_sub_return_fn1` with external refs as params.

### Short-circuit polyfill → if block

```javascript
// Input
"undefined"==typeof Element||Element.prototype.addEventListener||(u=[],Ao=function(n,t){for(var e=0;e<u.length;){var r=u[e];if(r.object===this&&r.type===n){u.splice(e,1);break}++e}},Element.prototype.addEventListener=qo=function(n,t){function e(n){n.target=n.srcElement}t.handleEvent?t.handleEvent(n):t.call(i,n)})

// Output
if ("undefined" != typeof Element && !Element.prototype.addEventListener) {
  u = [];
  Ao = function (n, t) {
    for (var e = 0; e < u.length;) {
      var r = u[e];
      if (r.object === this && r.type === n) {
        u.splice(e, 1);
        break;
      }
      ++e;
    }
  };
  qo = function (n, t) {
    function e(n) {
      n.target = n.srcElement;
    }
    if (t.handleEvent) {
      t.handleEvent(n);
    } else {
      t.call(i, n);
    }
  };
  Element.prototype.addEventListener = qo;
}
```

↑ `A||B||(C,D,E)` → `if(!A&&!B){C;D;E;}`; chained assignment split; ternary expanded.

### Ternary variable → if/else

```javascript
// Input
var handler="complete"===document.readyState?function(n){n(),console.log("done")}:function(n){document.addEventListener("DOMContentLoaded",n)}

// Output
var handler;
if ("complete" === document.readyState) {
  handler = function (n) {
    n();
    console.log("done");
  };
} else {
  handler = function (n) {
    document.addEventListener("DOMContentLoaded", n);
  };
}
```

↑ `var x = cond ? a : b` → `var x; if/else` with full block formatting.

## Naming Convention

All extracted sub-functions follow: `_sub_<parent>_<seq>_<description>`

| Component | Meaning |
|-----------|---------|
| `_sub_` | Prefix for extracted sub-functions |
| `<parent>` | Parent function name, method name, or `lnXXXX` for anonymous |
| `<seq>` | Two-digit extraction order |
| `<description>` | `if`, `else`, `try`, `catch`, `init_vars`, `iife_body`... |

## API

```javascript
const { main } = require("./scripts");
main({ input: "obfuscated.js", output: "out/", split: true });
```

## Directory Structure

```
deob.js               ← CLI entry point
scripts/
├── pipeline.js       ← Main orchestration (20 passes)
├── extract.js        ← Syntactic splitting (IIFE, try-catch, if-else, switch…)
├── passes.js         ← All post-processing passes (hoist, simplify, short-circuit, dead-code, sanitize…)
├── traverse.js       ← Innermost-first function collection
├── metrics.js        ← Readability analysis + HTML Chart.js report
├── structure.js      ← Structure reports, compact index, tier filter, domain classification
├── ast-utils.js      ← AST walker, detectors, clone, await/yield detection
├── scope.js          ← Variable scope & external reference analysis
├── emit.js           ← Sub-function declaration builder with reserved-word sanitization
├── wrapper.js        ← Top-level IIFE extraction
├── config.js         ← Parser, generator, alert patterns, globals
├── index.js          ← Public API exports
```

## License

ISC

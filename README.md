# deob

Universal JavaScript deobfuscation pipeline — splits obfuscated code into readable sub-functions by syntactic structure.

Zero configuration. Works on any obfuscated JavaScript: **obfuscator.io**, **JSVMP**, **webpack bundles**, **minified code**.

## Quick Start

```bash
npm install
npm link

# Single file
deob main.js

# Custom output
deob main.js output.js

# Split into per-function files
deob main.js output/ --split

# Generate readability metrics report
deob main.js --metrics
deob main.js --split --metrics
```

## Pipeline (14 passes)

| Step | Pass | Description |
|------|------|-------------|
| 1 | `traverse` | Collect all function nodes, process innermost-first |
| 2 | `wrapper` | Extract top-level IIFEs to named wrappers |
| 3 | `hoist` | Move var/let/const/function to top of every scope |
| 4 | `extract-inline` | Lift embedded function expressions out of return/assignment |
| 5 | `simplify` | **Combined**: fold + boolean + strings + ast-normalize in one walk |
| 6 | `expand-seq` | Break comma chains into independent statements |
| 7 | `dead-code` | Remove if(false), unreachable code after return |
| 8 | `inline-props` | Replace config.PROP with literal values (45K+ inlined) |
| 9 | `unused` | Remove helper functions never referenced |
| 10 | `conditions` | Simplify a?true:false→!!a, if-return patterns |
| 11 | `wrappers` | Inline pure wrapper functions |
| 12 | `call-tree` | Topological sort: callees before callers |
| 13 | `single-caller` | Inline functions called from exactly one place |
| 14 | `normalize` | Statement-list: multi-decl split, sequence unwrap, for(;;)→while(true) |

## Output

```javascript
// Before: obfuscated
function a0_0x5465(_0x147aca,_0x1c469e){const _0x477d9d=a0_0x1cb6();return (a0_0x5465=function(...){...}),a0_0x5465(...)}

// After: deobfuscated
function a0_0x5465(_0x147aca, _0x1c469e) {
  const _0x477d9d = a0_0x1cb6();
  return (
    (a0_0x5465 = _sub_return_fn1),
    a0_0x5465(_0x147aca, _0x1c469e)
  );
}

// Original lines 1-170
function _sub_return_fn1(_0x4d3a42, _0x55eff5, _0x477d9d, _0x147aca, a0_0x5465, _0x52d22c) {
  _0x4d3a42 = _0x4d3a42 - 295;
  let _0x5711d9 = _0x477d9d[_0x4d3a42];
  // ...
}
```

## API

```javascript
const { main } = require("./scripts");
main({ input: "obfuscated.js", output: "clean.js" });           // single file
main({ input: "obfuscated.js", output: "out/", split: true });  // split mode
```

## Directory Structure

```
scripts/
├── pipeline.js       ← Main orchestration
├── extract.js        ← Splitting rules (IIFE, try-catch, if-else, …)
├── traverse.js       ← Innermost-first function collection
├── passes.js         ← 14 post-processing passes
├── ast-utils.js      ← Generic AST walker, detectors, clone
├── scope.js          ← Variable scope & external reference analysis
├── emit.js           ← Sub-function declaration builder
├── naming.js         ← _sub_PARENT_SEQ_desc naming convention
├── wrapper.js        ← Top-level IIFE extraction
├── config.js         ← Parser, generator, globals
└── index.js          ← Public API exports
```

## Adding a Pass

1. Write your function in `passes.js`
2. Require it in `pipeline.js`
3. Add a `console.log("Step N: …")` + call in `main()`

```javascript
// passes.js
function myPass(ast) {
  let count = 0;
  walkAST(ast, (node) => { /* transform */ count++; });
  console.log(`  Processed ${count} patterns`);
}
```

## License

ISC

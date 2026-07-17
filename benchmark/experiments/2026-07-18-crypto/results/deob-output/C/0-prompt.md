You are analyzing deobfuscated JavaScript from `main.js`. The preprocessor already determined:

## Architecture
- 27 functions (3 original, 24 extracted)
- Domain: **General JS**
- 1 flattened, 0 suspicious patterns, max complexity 11
- Code density: 96% active code, 4% data/other
- **String decoder**: `a0_0x5f17` — self-modifying lookup, called by 2 functions. Strings are NOT yet decoded — you will see opaque calls like `_0x13f90f(0x1818)`.
- **Entry point**: `a0_0x2394` → a0_0x5f17, _S_a0_0x2394_04_if, _S_a0_0x2394_06_if, _S_a0_0x2394_06_else
- **Closure captures**: 31 variables captured by 9 functions
- **Shared variables**: _0x2f5bcc (9 functions), _0x4db70b (9 functions), a0_0x2394 (6 functions), _0x3d6f39 (3 functions), a0_0x5f17 (2 functions)

## Alerts (0 significant)
_No significant security alerts detected._


## Start Here (top 5 by interest score)
_Function: name | Ss/Pp | cc=N → callees ⇐ callers | tags — description_
1. `_S_program_declare_fn_l159` | 19S/undefinedP | cc=11 → _S_return_1_fn_2, _S_return_2_fn, _S_return_3_fn root [flattened, cc=11] — returns expr [module-init]
2. `_S__0x3640f7_1_fn` | 8S/undefinedP | cc=8 [cc=8] — calls → decodeURIComponent
3. `_S_return_2_fn` | 12S/undefinedP | cc=5 ⇐ _S_program_declare_fn_l159 [core] — calls expr
4. `_S_program_loop_body_l136` | 3S/undefinedP | cc=4 [core] — void, 3S; callback-driven [module-init]
5. `_S__0x5f1713_2_fn` | 9S/undefinedP | cc=4 [core] — returns arg

## Skip
2 pass-through functions (zero logic). See `2-index.txt` for full function catalog.

## Reading Path
1. **This file** (0-prompt.md) — architecture, alerts, top 5 functions to start with
2. **1-structure.md** — call graph, hotspots, full alert traces, naming convention
3. **2-index.txt** — function catalog with line numbers → jump to `main.js`

You are analyzing deobfuscated JavaScript from `main.js`. The preprocessor already determined:

## Architecture
- 13 functions (2 original, 11 extracted)
- Domain: **General JS**
- Max complexity: 8

- **String decoder**: `a0_0x522f` (strings NOT decoded)
- **Entry point**: `a0_0x2c22` → a0_0x522f, $11_if, $12_if, $13_else
- **Closure captures**: 23 variables captured by 3 functions
- **Shared variables**: _0x47fe44 (9 functions), _0x1849d1 (9 functions), a0_0x2c22 (5 functions), a0_0x522f (2 functions), _0x77e496 (2 functions)



## Start Here
1. `$17_fn` — [calls → decodeURIComponent]
2. `$14_loop_body` — [void, 3S; callback-driven]
3. `a0_0x2c22` — [returns arg]
4. `$12_if` — [void, 7S; side-effects]
5. `$18_fn` — [returns arg]


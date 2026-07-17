// Pass function type declarations

import { ASTNode, PassFunction } from "./ast";

/** Simplify: constant folding + boolean + string (incl. .concat) + hex normalization */
export declare function simplify(ast: ASTNode): void;

/** Convert logical ||/&& to if blocks */
export declare function normalizeShortCircuit(ast: ASTNode): void;

/** Break comma chains into independent statements */
export declare function expandSequences(ast: ASTNode): void;

/** Simplify if-return→ternary, !!a, !(a==b), De Morgan, negated variants */
export declare function simplifyRedundantConditions(ast: ASTNode): void;

/** ~arr.indexOf→arr.includes, reversed typeof, multi-decl split (non-trivial only) */
export declare function normalizeSyntax(ast: ASTNode): void;

/** Replace obj.prop with literal (all scopes) */
export declare function inlineConstObjects(ast: ASTNode): void;

/** Remove unreachable, if(false), empty if/else branches */
export declare function eliminateDeadCode(ast: ASTNode): void;

/** Delete unreferenced functions (_0x prefix + unique dead names) */
export declare function removeUnusedHelpers(ast: ASTNode): void;

/** Move DATA-heavy functions to end of file */
export declare function pushDataToBottom(ast: ASTNode): void;

/** Replace cfg.PROP with literal (all scopes, per-property mutation, hasOwnProperty) */
export declare function inlineReadOnlyProperties(ast: ASTNode): void;

/** Inline return call(args) + .apply(this,args) + .call(this,...) wrappers */
export declare function inlinePureWrappers(ast: ASTNode): void;

/** Collapse function(a,b){return a+b} at call sites */
export declare function inlineArithmeticWrappers(ast: ASTNode): void;

/** Inline functions called from exactly one place */
export declare function inlineSingleCallerFns(ast: ASTNode): void;

/** Lift function expressions (enclosing scope defs, skip 1-stmt, external refs) */
export declare function extractInlineFunctions(ast: ASTNode): void;

/** Move imports/exports/var/function to top of scope */
export declare function hoistDeclarations(ast: ASTNode): void;

/** Rename reserved-word identifiers */
export declare function sanitizeReservedWords(ast: ASTNode): void;

/** Inject [Label] comments + metadata banners (_S_ functions) */
export declare function annotateAlerts(ast: ASTNode): void;

/** Topological sort: callees before callers */
export declare function sortByCallTree(ast: ASTNode): void;

/** Clear inline function name tracker */
export declare function resetInlineNames(): void;

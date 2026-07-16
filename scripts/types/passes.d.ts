// Pass function type declarations

import { ASTNode, PassFunction } from "./ast";

/** Simplify pass: constant folding + boolean + string + hex normalization */
export declare function simplify(ast: ASTNode): void;

/** Convert logical ||/&& to if blocks */
export declare function normalizeShortCircuit(ast: ASTNode): void;

/** Break comma chains into independent statements */
export declare function expandSequences(ast: ASTNode): void;

/** Simplify if(a) return true; return false → return !!a */
export declare function simplifyRedundantConditions(ast: ASTNode): void;

/** ~arr.indexOf → arr.includes, ~~x → Math.trunc, etc. */
export declare function normalizeSyntax(ast: ASTNode): void;

/** Replace obj.prop with literal when obj is const object */
export declare function inlineConstObjects(ast: ASTNode): void;

/** Remove unreachable statements, if(false) branches */
export declare function eliminateDeadCode(ast: ASTNode): void;

/** Delete unreferenced function declarations */
export declare function removeUnusedHelpers(ast: ASTNode): void;

/** Move DATA-heavy functions to end of file */
export declare function pushDataToBottom(ast: ASTNode): void;

/** Replace cfg.PROP with literal value */
export declare function inlineReadOnlyProperties(ast: ASTNode): void;

/** Remove functions that are just return call(args) */
export declare function inlinePureWrappers(ast: ASTNode): void;

/** Collapse trivial operator wrappers */
export declare function inlineArithmeticWrappers(ast: ASTNode): void;

/** Inline functions called from exactly one place */
export declare function inlineSingleCallerFns(ast: ASTNode): void;

/** Lift embedded function expressions to top level */
export declare function extractInlineFunctions(ast: ASTNode): void;

/** Move imports/exports/var/function to top of scope */
export declare function hoistDeclarations(ast: ASTNode): void;

/** Rename reserved-word identifiers */
export declare function sanitizeReservedWords(ast: ASTNode): void;

/** Inject [Label] comments for security-relevant patterns */
export declare function annotateAlerts(ast: ASTNode): void;

/** Topological sort: callees before callers */
export declare function sortByCallTree(ast: ASTNode): void;

/** Clear inline function name tracker */
export declare function resetInlineNames(): void;

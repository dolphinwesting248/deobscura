// AST helper types

import { Node, FunctionDeclaration, FunctionExpression, ArrowFunctionExpression,
         VariableDeclaration, Statement, Expression, BlockStatement,
         Identifier, StringLiteral, NumericLiteral, BooleanLiteral } from "@babel/types";

/** Any Babel AST node */
export type ASTNode = Node;

/** Walk callback for read-only traversal */
export type WalkVisitor = (node: ASTNode, state?: any) => void;

/** Walk callback for transform traversal (returns replacement) */
export type TransformVisitor = (node: ASTNode) => ASTNode;

/** Result from extract functions (tryExtract, extractIIFE, etc.) */
export interface ExtractResult {
  replacement: ASTNode;
  subFns: FunctionDeclaration[];
}

/** Result from processBody */
export interface ProcessResult {
  newBody: Statement[];
  subFns: FunctionDeclaration[];
}

/** Pass function signature — mutates AST in place, returns void */
export type PassFunction = (ast: ASTNode) => void;

/** Sub-function creation params */
export interface SubFnParams {
  name: string;
  params: Identifier[];
  body: Statement[];
  sourceNode?: ASTNode;
}

/** Body description hint */
export type BodyHint = "if" | "else" | "try" | "catch" | "case" | "iife_body" |
  "init_vars" | "declare_fn" | "return_val" | "body" | "block" | "fn";

/** Callback info from findCallbacks */
export interface CallbackInfo {
  fn: FunctionExpression | ArrowFunctionExpression;
  hint: string;
  replace: (node: ASTNode) => void;
}

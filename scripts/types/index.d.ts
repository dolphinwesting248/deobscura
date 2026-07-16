// deob type declarations — entry point
//
// These types describe the internal data structures and function signatures
// used across the deob pipeline. They provide IDE support for the existing
// JavaScript codebase without requiring a TypeScript migration.

export * from "./analysis";
export * from "./ast";
export * from "./constants";
export * from "./passes";

// Re-export config types (user-facing)
export { DenoiseRule, DeobConfig, Severity } from "../config-types";

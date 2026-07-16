// Constants type declarations

export type Severity = "critical" | "high" | "medium" | "low" | "info";

export interface AlertPattern {
  label: string;
  regex: RegExp;
  severity: Severity;
}

export interface Thresholds {
  DATA_STRING_LEN: number;
  BIG_COLLECTION: number;
  HEX_DENSITY: number;
  HUGE_LINE_LEN: number;
  HUGE_LINE_DENSITY: number;
  COMPLEXITY_HIGH: number;
  DISPLAY_LIMIT: number;
  ALERT_DISPLAY_LIMIT: number;
  MAX_NAME_LEN: number;
  SEQ_PAD_WIDTH: number;
  HEX_NORM_MAX: number;
  PROP_SETTER_THRESHOLD: number;
  BUILD_COUNT_THRESHOLD: number;
  EVENT_LISTENER_THRESHOLD: number;
  EVAL_THRESHOLD: number;
  ARITH_WRAPPER_MAX_IDENTS: number;
  ARITH_WRAPPER_MAX_PARAMS: number;
  DEAD_CODE_PASSES: number;
  SIMPLIFY_PASSES: number;
  ALERT_SCORE_MULTIPLIER: number;
  HOT_THRESHOLD: number;
  LOOKUP_WORD_CAP: number;
  COMMENT_PROXIMITY: number;
}

export interface OutputFiles {
  MAIN: string;
  PROMPT: string;
  STRUCTURE: string;
  INDEX: string;
  METRICS: string;
  SUMMARY: string;
}

export type Category = "data" | "core" | "framework" | "network" | "websocket" |
  "crypto" | "parser" | "i18n" | "polyfill" | "filesystem" | "timer" |
  "construct" | "delegate" | "varargs" | "boilerplate" | "callback" |
  "branch" | "dynamic" | "other";

export interface NamingExample {
  name: string;
  meaning: string;
}

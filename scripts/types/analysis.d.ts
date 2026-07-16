// Structure analysis types

export interface FunctionMeta {
  name: string;
  lines: [number, number];
  params: string[];
  calls: string[];
  calledBy: string[];
  complexity: number;
  flat: boolean;
  suspicious: string[];
  description: string;
  semanticTags: string[];
  paramRoles: string;
  bodyLen: number;
  category?: string;
  score?: number;
}

export interface Alert {
  fn: string;
  line: number;
  label: string;
  severity: "critical" | "high" | "medium" | "low" | "info";
  matches: string[];
}

export interface Hotspots {
  mostCalled: FunctionMeta[];
  roots: FunctionMeta[];
  leaves: FunctionMeta[];
  hotGroups: [string, number][];
}

export interface NamingConvention {
  format: string;
  collision: string;
  examples: { name: string; meaning: string }[];
  hints: Record<string, string>;
}

export interface Summary {
  totalFunctions: number;
  originalFunctions: number;
  subFunctions: number;
  maxDepth: number;
  maxComplexity: number;
  flattened: number;
  suspicious: number;
}

export interface StructureReport {
  file: string;
  summary: Summary;
  hotspots: Hotspots;
  alerts: Alert[];
  functions: FunctionMeta[];
  naming: NamingConvention;
  tracePath?: string[];
  alertTraces?: AlertTrace[];
  tldr?: string;
  _filepath?: string;
  _density?: string;
}

export interface AlertTrace {
  label: string;
  fn: string;
  path: string[];
}

export interface DenoiseRule {
  match: string;
  label: string;
  severity?: "critical" | "high" | "medium" | "low" | "info";
}

export interface DeobConfig {
  input: string | string[];
  output?: string;
  split?: boolean;
  metrics?: boolean;
  md?: boolean;
  index?: boolean;
  tier?: 1 | 2 | 3;
  fold?: boolean;
  denoise?: DenoiseRule[];
}

export interface DensityResult {
  code: number;
  data: number;
  ratio: string;
}

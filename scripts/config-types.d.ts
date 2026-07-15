// Type definitions for deob.config.js
// No runtime dependency — used only for IDE IntelliSense via JSDoc @type annotation

type Severity = "critical" | "high" | "medium" | "low" | "info";

interface DenoiseRule {
  /** Regular expression to match against alert strings */
  match: string;
  /** Replacement alert label */
  label: string;
  /** Replacement severity (optional — keeps original if omitted) */
  severity?: Severity;
}

interface DeobConfig {
  /** Input path: single file, directory, or array of paths */
  input: string | string[];
  /** Output directory (auto-derived from input if omitted) */
  output?: string;
  /** Split output into per-function files */
  split?: boolean;
  /** Generate HTML readability metrics report */
  metrics?: boolean;
  /** Generate Markdown structure report */
  md?: boolean;
  /** Generate compact index.txt */
  index?: boolean;
  /** Output tier: 1=alerts+hotspots, 2=+callees, 3=all */
  tier?: 1 | 2 | 3;
  /** Collapse mechanical functions (polyfill/pure-compute/forward) */
  fold?: boolean;
  /** Alert denoising rules. Empty array = no denoising. Omit = use defaults. */
  denoise?: DenoiseRule[];
}

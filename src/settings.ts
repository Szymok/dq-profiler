import type { ParsedCsv } from "./csv";
import type { ColumnRule, ReportConfig, RequiredField } from "./report";
import { suggestRule, type Rule, type RuleKind } from "./rules";

export type RuleChoice = RuleKind | "none";

/** What the user chose for one column in the interface. */
export interface ColumnSetting {
  column: string;
  required: boolean;
  /** Conditional completeness: required only when `condition.column` equals `condition.equals`. */
  condition?: { column: string; equals: string };
  rule: RuleChoice;
  /** Only for number_range. */
  min?: number;
  max?: number;
  /** Part of the key that should identify a row. */
  key: boolean;
  /** Where the suggested rule came from, for the hint next to the selector. */
  suggestedFrom?: "name" | "content";
}

/** Starting point: every column required, rules suggested from names and content, no key. */
export function initialSettings(csv: ParsedCsv, today: string): ColumnSetting[] {
  return csv.headers.map((column, i) => {
    const suggestion = suggestRule(column, csv.rows.map((r) => r[i]), { today });
    return {
      column,
      required: true,
      rule: suggestion?.kind ?? "none",
      key: false,
      ...(suggestion ? { suggestedFrom: suggestion.source } : {}),
    };
  });
}

const isNumber = (n: number | undefined): n is number => typeof n === "number" && !Number.isNaN(n);

/** Turn the interface state into a report configuration. Incomplete conditions and empty ranges are dropped. */
export function buildConfig(settings: ColumnSetting[], today: string): ReportConfig {
  const required: RequiredField[] = [];
  const rules: ColumnRule[] = [];
  const keyColumns: string[] = [];
  for (const s of settings) {
    if (s.required) {
      const c = s.condition;
      const hasCondition = c !== undefined && c.column !== "" && c.equals.trim() !== "";
      required.push(hasCondition ? { column: s.column, when: { column: c.column, equals: c.equals } } : { column: s.column });
    }
    if (s.rule !== "none") {
      const rule: Rule = { kind: s.rule };
      if (s.rule === "number_range") {
        if (isNumber(s.min)) rule.min = s.min;
        if (isNumber(s.max)) rule.max = s.max;
      }
      rules.push({ column: s.column, rule });
    }
    if (s.key) keyColumns.push(s.column);
  }
  return { required, rules, ...(keyColumns.length ? { keyColumns } : {}), today };
}

/** Local calendar date as ISO (not UTC, so "today" matches the user's clock). */
export function localIsoDate(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

import { isMissing, toIsoDate } from "./profile";
import { isValidEmail, isValidNip, isValidPhonePl, isValidPostalCodePl } from "./validators";

export type RuleKind = "email" | "nip" | "postal_code_pl" | "phone_pl" | "date_not_future" | "number_range";

export interface Rule {
  kind: RuleKind;
  /** Only for number_range. */
  min?: number;
  max?: number;
}

export interface RuleContext {
  /** Today as ISO date; injected so results are reproducible. */
  today: string;
}

export interface RuleResult {
  kind: RuleKind;
  /** Non-missing values that were checked. Missing values belong to completeness, not validity. */
  checked: number;
  invalid: number;
  /** Share of valid values, 0-100 (one decimal). 100 when nothing was checked. */
  validPct: number;
  /** Up to five distinct invalid values. */
  examples: string[];
}

function check(value: string, rule: Rule, ctx: RuleContext): boolean {
  switch (rule.kind) {
    case "email":
      return isValidEmail(value);
    case "nip":
      return isValidNip(value);
    case "postal_code_pl":
      return isValidPostalCodePl(value);
    case "phone_pl":
      return isValidPhonePl(value);
    case "date_not_future": {
      const iso = toIsoDate(value);
      return iso !== undefined && iso <= ctx.today;
    }
    case "number_range": {
      const n = Number(value.trim().replace(",", "."));
      if (Number.isNaN(n)) return false;
      return (rule.min === undefined || n >= rule.min) && (rule.max === undefined || n <= rule.max);
    }
  }
}

export function applyRule(values: (string | undefined)[], rule: Rule, ctx: RuleContext): RuleResult {
  let checked = 0;
  let invalid = 0;
  const examples = new Set<string>();
  for (const v of values) {
    if (isMissing(v)) continue;
    checked++;
    if (!check(v!, rule, ctx)) {
      invalid++;
      if (examples.size < 5) examples.add(v!.trim());
    }
  }
  const validPct = checked === 0 ? 100 : Math.round((1000 * (checked - invalid)) / checked) / 10;
  return { kind: rule.kind, checked, invalid, validPct, examples: [...examples] };
}

export interface Suggestion {
  kind: RuleKind;
  source: "name" | "content";
}

const NAME_HINTS: [RegExp, RuleKind][] = [
  [/e-?mail|^mail$/i, "email"],
  [/(^|[^a-z])nip([^a-z]|$)|tax_?id|vat/i, "nip"],
  [/kod.?pocztowy|zip|postal/i, "postal_code_pl"],
  [/telefon|phone|tel(\b|_)|komorka|mobile/i, "phone_pl"],
  [/data|date|created|utworzen/i, "date_not_future"],
];

const CONTENT_THRESHOLD = 0.8;

/**
 * Suggest a validity rule for a column. Header name wins; otherwise the content is checked
 * against the format rules (not the date rule: a date column can legitimately hold future dates).
 * This is only a hint; the user chooses the rule.
 */
export function suggestRule(name: string, values: (string | undefined)[], ctx: RuleContext): Suggestion | undefined {
  for (const [pattern, kind] of NAME_HINTS) {
    if (pattern.test(name)) return { kind, source: "name" };
  }
  const filled = values.filter((v) => !isMissing(v)) as string[];
  if (filled.length === 0) return undefined;
  const formats: RuleKind[] = ["email", "postal_code_pl", "nip", "phone_pl"];
  for (const kind of formats) {
    const ok = filled.filter((v) => check(v, { kind }, ctx)).length;
    if (ok / filled.length >= CONTENT_THRESHOLD) return { kind, source: "content" };
  }
  return undefined;
}

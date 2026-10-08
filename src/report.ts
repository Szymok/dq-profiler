import type { ParsedCsv } from "./csv";
import { isMissing, profileTable } from "./profile";
import { applyRule, suggestRule, type Rule, type RuleKind, type RuleResult } from "./rules";

export type Status = "green" | "yellow" | "red";
export type Dimension = "completeness" | "uniqueness" | "validity";

/** Thresholds of the Scorecard: green from 95%, yellow from 85%, red below. */
export const THRESHOLDS = { green: 95, yellow: 85 } as const;

export function statusFor(pct: number): Status {
  if (pct >= THRESHOLDS.green) return "green";
  if (pct >= THRESHOLDS.yellow) return "yellow";
  return "red";
}

export const RULE_LABELS: Record<RuleKind, string> = {
  email: "format e-mail",
  nip: "NIP (suma kontrolna)",
  postal_code_pl: "kod pocztowy",
  phone_pl: "telefon",
  date_not_future: "data nie z przyszłości",
  number_range: "zakres liczbowy",
};

export interface RequiredField {
  column: string;
  /** Conditional completeness: the field is required only in rows where `when.column` equals `when.equals`. */
  when?: { column: string; equals: string };
}

export interface ColumnRule {
  column: string;
  rule: Rule;
}

export interface ReportConfig {
  required: RequiredField[];
  rules: ColumnRule[];
  /** Columns that together should identify a row; used for uniqueness. Without them whole rows are compared. */
  keyColumns?: string[];
  /** Today as ISO date (injected, so reports are reproducible). */
  today: string;
}

export interface DimensionScore {
  dimension: Dimension;
  /** null when the dimension could not be measured with this configuration. */
  scorePct: number | null;
  status: Status | null;
  detail: string;
}

export interface FieldResult {
  column: string;
  condition?: string;
  /** Rows in which the field is required. */
  applicable: number;
  filled: number;
  completenessPct: number;
}

export interface ColumnIssue {
  column: string;
  scorePct: number;
  reason: string;
}

export interface Report {
  rows: number;
  columns: number;
  dimensions: DimensionScore[];
  overallPct: number | null;
  overallStatus: Status | null;
  /** Share of rows in which every required field is filled. */
  completeRecordsPct: number | null;
  fields: FieldResult[];
  ruleResults: { column: string; label: string; result: RuleResult }[];
  worstColumns: ColumnIssue[];
  warnings: string[];
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const pct = (part: number, whole: number) => round1((100 * part) / whole);
const norm = (v: string | undefined) => (v ?? "").trim().toLowerCase();

/** Default configuration: every column required, rules suggested from names and content. */
export function defaultConfig(csv: ParsedCsv, today: string): ReportConfig {
  const rules: ColumnRule[] = [];
  csv.headers.forEach((name, i) => {
    const suggestion = suggestRule(name, csv.rows.map((r) => r[i]), { today });
    if (suggestion) rules.push({ column: name, rule: { kind: suggestion.kind } });
  });
  return { required: csv.headers.map((column) => ({ column })), rules, today };
}

function score(dimension: Dimension, scorePct: number | null, detail: string): DimensionScore {
  return { dimension, scorePct, status: scorePct === null ? null : statusFor(scorePct), detail };
}

export function computeReport(csv: ParsedCsv, config: ReportConfig): Report {
  const warnings: string[] = [];
  const rows = csv.rows.length;
  const index = (name: string, context: string): number => {
    const i = csv.headers.indexOf(name);
    if (i === -1) warnings.push(`Pominięto ${context}: nie ma kolumny „${name}".`);
    return i;
  };

  // --- completeness (with conditional requirements) ---
  const required = config.required
    .map((f) => ({
      field: f,
      i: index(f.column, "pole wymagane"),
      w: f.when ? index(f.when.column, `warunek dla „${f.column}"`) : -2,
    }))
    .filter((x) => x.i !== -1 && x.w !== -1);

  const fieldStats = required.map(() => ({ applicable: 0, filled: 0 }));
  let applicableTotal = 0;
  let filledTotal = 0;
  let rowsWithApplicable = 0;
  let completeRows = 0;
  for (const row of csv.rows) {
    let applicable = 0;
    let filled = 0;
    required.forEach((x, k) => {
      if (x.field.when && norm(row[x.w]) !== norm(x.field.when.equals)) return;
      applicable++;
      fieldStats[k]!.applicable++;
      if (!isMissing(row[x.i])) {
        filled++;
        fieldStats[k]!.filled++;
      }
    });
    applicableTotal += applicable;
    filledTotal += filled;
    if (applicable > 0) {
      rowsWithApplicable++;
      if (filled === applicable) completeRows++;
    }
  }

  const fields: FieldResult[] = required.map((x, k) => ({
    column: x.field.column,
    ...(x.field.when ? { condition: `${x.field.when.column} = ${x.field.when.equals}` } : {}),
    applicable: fieldStats[k]!.applicable,
    filled: fieldStats[k]!.filled,
    completenessPct: fieldStats[k]!.applicable === 0 ? 100 : pct(fieldStats[k]!.filled, fieldStats[k]!.applicable),
  }));
  const completenessPct = applicableTotal === 0 ? null : pct(filledTotal, applicableTotal);
  const completeRecordsPct = rowsWithApplicable === 0 ? null : pct(completeRows, rowsWithApplicable);

  // --- uniqueness ---
  let uniquenessPct: number | null = null;
  let uniquenessDetail = "Brak wierszy.";
  const keyIdx = (config.keyColumns ?? []).map((c) => index(c, "kolumna klucza")).filter((i) => i !== -1);
  if (rows > 0) {
    if (keyIdx.length > 0) {
      const seen = new Set<string>();
      let compared = 0;
      let duplicates = 0;
      for (const row of csv.rows) {
        const cells = keyIdx.map((i) => row[i]);
        if (cells.some((c) => isMissing(c))) continue;
        compared++;
        const key = cells.map(norm).join("\u0001");
        if (seen.has(key)) duplicates++;
        else seen.add(key);
      }
      uniquenessPct = compared === 0 ? null : round1(100 - pct(duplicates, compared));
      uniquenessDetail =
        compared === 0
          ? "Żaden wiersz nie ma pełnego klucza."
          : `Duplikaty klucza (${(config.keyColumns ?? []).join(", ")}): ${duplicates} z ${compared} wierszy.` +
            (compared < rows ? ` Wiersze z brakiem w kluczu (${rows - compared}) pominięto.` : "");
    } else {
      const dup = profileTable(csv).duplicateRows;
      uniquenessPct = round1(100 - pct(dup, rows));
      uniquenessDetail = `Identyczne wiersze: ${dup} z ${rows}.`;
    }
  }

  // --- validity ---
  const ruleResults: Report["ruleResults"] = [];
  let checkedTotal = 0;
  let invalidTotal = 0;
  for (const cr of config.rules) {
    const i = index(cr.column, "reguła");
    if (i === -1) continue;
    const result = applyRule(csv.rows.map((r) => r[i]), cr.rule, { today: config.today });
    ruleResults.push({ column: cr.column, label: RULE_LABELS[cr.rule.kind], result });
    checkedTotal += result.checked;
    invalidTotal += result.invalid;
  }
  const validityPct = checkedTotal === 0 ? null : round1(100 - pct(invalidTotal, checkedTotal));

  const dimensions: DimensionScore[] = [
    score(
      "completeness",
      completenessPct,
      completenessPct === null
        ? "Nie wskazano pól wymaganych."
        : `Wypełnione pola wymagane: ${filledTotal} z ${applicableTotal}. W pełni kompletne rekordy: ${completeRows} z ${rowsWithApplicable} (${completeRecordsPct}%).`,
    ),
    score("uniqueness", uniquenessPct, uniquenessDetail),
    score(
      "validity",
      validityPct,
      validityPct === null ? "Nie wybrano reguł ważności." : `Niepoprawne wartości: ${invalidTotal} z ${checkedTotal} sprawdzonych (puste pominięto).`,
    ),
  ];

  const measured = dimensions.filter((d) => d.scorePct !== null).map((d) => d.scorePct as number);
  const overallPct = measured.length === 0 ? null : round1(measured.reduce((a, b) => a + b, 0) / measured.length);

  // --- worst columns: lowest score per column across completeness and validity ---
  const worst = new Map<string, ColumnIssue>();
  const offer = (column: string, scorePct: number, reason: string) => {
    if (scorePct >= 100) return;
    const current = worst.get(column);
    if (!current || scorePct < current.scorePct) worst.set(column, { column, scorePct, reason });
  };
  for (const f of fields) offer(f.column, f.completenessPct, f.condition ? `kompletność (gdy ${f.condition})` : "kompletność");
  for (const r of ruleResults) offer(r.column, r.result.validPct, `ważność: ${r.label}`);
  const worstColumns = [...worst.values()].sort((a, b) => a.scorePct - b.scorePct || a.column.localeCompare(b.column)).slice(0, 10);

  return {
    rows,
    columns: csv.headers.length,
    dimensions,
    overallPct,
    overallStatus: overallPct === null ? null : statusFor(overallPct),
    completeRecordsPct,
    fields,
    ruleResults,
    worstColumns,
    warnings,
  };
}

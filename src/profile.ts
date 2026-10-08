import type { ParsedCsv } from "./csv";

export type ColumnType = "integer" | "number" | "date" | "boolean" | "text" | "empty";

export interface ColumnProfile {
  name: string;
  index: number;
  rows: number;
  missing: number;
  /** Share of non-missing values, 0-100 (one decimal). 100 for a table without rows. */
  completenessPct: number;
  distinct: number;
  type: ColumnType;
  /** Smallest / largest value for integer, number (as written) and date (ISO) columns. */
  min?: string;
  max?: string;
}

export interface TableProfile {
  rows: number;
  columns: ColumnProfile[];
  /** Rows identical to an earlier row (the first occurrence is not counted). */
  duplicateRows: number;
}

/** Spellings that mean "no value" although the cell is not literally empty. */
const PLACEHOLDERS = new Set(["", "-", "--", "---", "n/d", "n/a", "brak", "null"]);

export function isMissing(value: string | undefined): boolean {
  return value === undefined || PLACEHOLDERS.has(value.trim().toLowerCase());
}

const INTEGER = /^[+-]?(0|[1-9]\d*)$/;
const NUMBER = /^[+-]?(0|[1-9]\d*)([.,]\d+)?$/;
const BOOLEAN = new Set(["true", "false", "tak", "nie", "yes", "no"]);

/** Parse ISO (2025-01-31), Polish (31.01.2025) and slash (31/01/2025) dates; returns ISO or undefined. */
export function toIsoDate(value: string): string | undefined {
  const v = value.trim();
  let y: number, m: number, d: number;
  let match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (match) {
    [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else if ((match = /^(\d{2})[./](\d{2})[./](\d{4})$/.exec(v))) {
    [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else {
    return undefined;
  }
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return undefined;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function classify(value: string): ColumnType {
  const v = value.trim();
  if (INTEGER.test(v)) return "integer";
  if (NUMBER.test(v)) return "number";
  if (toIsoDate(v) !== undefined) return "date";
  if (BOOLEAN.has(v.toLowerCase())) return "boolean";
  return "text";
}

/**
 * Infer a column type from its non-missing values. A type wins when at least `threshold`
 * of the values match it; integers count towards "number". Anything else is "text".
 */
export function inferType(values: string[], threshold = 0.9): ColumnType {
  if (values.length === 0) return "empty";
  const counts: Record<ColumnType, number> = { integer: 0, number: 0, date: 0, boolean: 0, text: 0, empty: 0 };
  for (const v of values) counts[classify(v)]++;
  const share = (n: number) => n / values.length;
  if (share(counts.integer) >= threshold) return "integer";
  if (share(counts.integer + counts.number) >= threshold) return "number";
  if (share(counts.date) >= threshold) return "date";
  if (share(counts.boolean) >= threshold) return "boolean";
  return "text";
}

function range(values: string[], type: ColumnType): { min?: string; max?: string } {
  if (type === "integer" || type === "number") {
    const nums = values.map((v) => ({ v: v.trim(), n: Number(v.trim().replace(",", ".")) })).filter((x) => !Number.isNaN(x.n));
    if (nums.length === 0) return {};
    const lo = nums.reduce((a, b) => (b.n < a.n ? b : a));
    const hi = nums.reduce((a, b) => (b.n > a.n ? b : a));
    return { min: lo.v, max: hi.v };
  }
  if (type === "date") {
    const dates = values.map(toIsoDate).filter((d): d is string => d !== undefined).sort();
    if (dates.length === 0) return {};
    return { min: dates[0], max: dates[dates.length - 1] };
  }
  return {};
}

const pct = (part: number, whole: number) => (whole === 0 ? 100 : Math.round((1000 * part) / whole) / 10);

export function profileTable(csv: ParsedCsv): TableProfile {
  const rows = csv.rows.length;
  const columns: ColumnProfile[] = csv.headers.map((name, index) => {
    const filled: string[] = [];
    for (const row of csv.rows) {
      const cell = row[index];
      if (!isMissing(cell)) filled.push(cell!);
    }
    const type = inferType(filled);
    return {
      name,
      index,
      rows,
      missing: rows - filled.length,
      completenessPct: pct(filled.length, rows),
      distinct: new Set(filled.map((v) => v.trim())).size,
      type,
      ...range(filled, type),
    };
  });

  const seen = new Set<string>();
  let duplicateRows = 0;
  for (const row of csv.rows) {
    const key = JSON.stringify(row);
    if (seen.has(key)) duplicateRows++;
    else seen.add(key);
  }
  return { rows, columns, duplicateRows };
}

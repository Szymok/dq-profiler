export type Delimiter = "," | ";" | "\t" | "|";

export interface ParsedCsv {
  headers: string[];
  rows: string[][];
  delimiter: Delimiter;
}

const CANDIDATES: Delimiter[] = [",", ";", "\t", "|"];

/** Decode bytes as UTF-8; fall back to Windows-1250 (common for Polish Excel exports). */
export function decodeBytes(bytes: ArrayBuffer | Uint8Array): { text: string; encoding: "utf-8" | "windows-1250" } {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(view), encoding: "utf-8" };
  } catch {
    return { text: new TextDecoder("windows-1250").decode(view), encoding: "windows-1250" };
  }
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** Pick the delimiter that splits the first lines into the most consistent number of columns. */
export function detectDelimiter(text: string): Delimiter {
  const lines = stripBom(text).split(/\r\n|\n|\r/).slice(0, 10).filter((l) => l.length > 0);
  let best: Delimiter = ",";
  let bestScore = 0;
  for (const d of CANDIDATES) {
    const counts = lines.map((l) => countOutsideQuotes(l, d));
    const first = counts[0] ?? 0;
    if (first === 0) continue;
    const consistent = counts.filter((c) => c === first).length;
    const score = consistent * 1000 + first;
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

function countOutsideQuotes(line: string, delimiter: string): number {
  let inQuotes = false;
  let count = 0;
  for (const ch of line) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === delimiter && !inQuotes) count++;
  }
  return count;
}

/** RFC 4180 parser: quoted fields, escaped quotes (""), CRLF/LF/CR, BOM. Trailing blank lines are dropped. */
export function parseCsv(input: string, delimiter?: Delimiter): ParsedCsv {
  const text = stripBom(input);
  const delim = delimiter ?? detectDelimiter(text);
  const records: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    records.push(row);
    row = [];
  };

  while (i < text.length) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
      } else {
        field += ch;
      }
      i++;
      continue;
    }
    if (ch === '"' && field === "") {
      inQuotes = true;
    } else if (ch === delim) {
      endField();
    } else if (ch === "\r") {
      if (text[i + 1] === "\n") i++;
      endRow();
    } else if (ch === "\n") {
      endRow();
    } else {
      field += ch;
    }
    i++;
  }
  if (field !== "" || row.length > 0) endRow();

  // A blank line parses to a single empty field; a row like ",," is data with missing values and must stay.
  while (records.length > 0 && records[records.length - 1]!.length === 1 && records[records.length - 1]![0] === "") records.pop();

  const headers = records.shift() ?? [];
  return { headers, rows: records, delimiter: delim };
}

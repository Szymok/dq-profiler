import type { Dimension, Report, Status } from "./report";
import { statusFor } from "./report";

export const OFFER_URL = "https://skszymon.eu/audyt-data-quality/";

const STATUS_LABEL: Record<Status, string> = { green: "zielony", yellow: "żółty", red: "czerwony" };
const STATUS_COLOR: Record<Status, string> = { green: "#1a7f37", yellow: "#9a6700", red: "#cf222e" };
const DIMENSION_LABEL: Record<Dimension, string> = {
  completeness: "Kompletność",
  uniqueness: "Unikalność",
  validity: "Ważność",
};

export function toJson(report: Report): string {
  return JSON.stringify(report, null, 2);
}

/** Escape text for HTML: column names and values come from the user's file and must never be markup. */
export function esc(value: unknown): string {
  return String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

const pctText = (n: number | null) => (n === null ? "nie zmierzono" : `${n}%`);

function statusBadge(status: Status | null): string {
  if (status === null) return "–";
  // Colour is never the only signal: the label is always written out.
  return `<span class="badge" style="background:${STATUS_COLOR[status]}">${STATUS_LABEL[status]}</span>`;
}

export interface HtmlOptions {
  title?: string;
  /** Include examples of invalid values (they come from the file; leave out when sharing the report). */
  includeExamples?: boolean;
}

/** Self-contained report: inline CSS, no scripts, no external requests. */
export function toHtml(report: Report, options: HtmlOptions = {}): string {
  const { title = "Raport jakości danych", includeExamples = true } = options;

  const dimensions = report.dimensions
    .map(
      (d) =>
        `<tr><th scope="row">${DIMENSION_LABEL[d.dimension]}</th><td>${pctText(d.scorePct)}</td><td>${statusBadge(d.status)}</td><td>${esc(d.detail)}</td></tr>`,
    )
    .join("");

  const worst = report.worstColumns.length
    ? report.worstColumns
        .map((w) => `<tr><th scope="row">${esc(w.column)}</th><td>${w.scorePct}%</td><td>${statusBadge(statusFor(w.scorePct))}</td><td>${esc(w.reason)}</td></tr>`)
        .join("")
    : `<tr><td colspan="4">Brak kolumn z problemami w wybranej konfiguracji.</td></tr>`;

  const rules = report.ruleResults
    .map((r) => {
      const examples = includeExamples && r.result.examples.length ? ` Przykłady: ${r.result.examples.map(esc).join(", ")}.` : "";
      return `<tr><th scope="row">${esc(r.column)}</th><td>${esc(r.label)}</td><td>${r.result.validPct}%</td><td>${r.result.invalid} z ${r.result.checked}.${examples}</td></tr>`;
    })
    .join("");

  const warnings = report.warnings.length ? `<ul class="warn">${report.warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>` : "";

  return `<!doctype html>
<html lang="pl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
body{font:16px/1.5 system-ui,sans-serif;max-width:56rem;margin:2rem auto;padding:0 1rem;color:#1f2328}
table{border-collapse:collapse;width:100%;margin:1rem 0}
th,td{border:1px solid #d0d7de;padding:.4rem .6rem;text-align:left;vertical-align:top}
thead th{background:#f6f8fa}
.badge{color:#fff;padding:.1rem .5rem;border-radius:1rem;font-size:.85rem;white-space:nowrap}
.summary{font-size:1.25rem}
.note{color:#57606a;font-size:.9rem}
.warn{color:#9a6700}
</style>
</head>
<body>
<h1>${esc(title)}</h1>
<p class="summary">Wynik łączny: <strong>${pctText(report.overallPct)}</strong> ${statusBadge(report.overallStatus)}</p>
<p>Wierszy: ${report.rows}, kolumn: ${report.columns}${report.completeRecordsPct === null ? "" : `, w pełni kompletnych rekordów: ${report.completeRecordsPct}%`}.</p>
${warnings}
<h2>Wymiary</h2>
<table><thead><tr><th>Wymiar</th><th>Wynik</th><th>Status</th><th>Szczegóły</th></tr></thead><tbody>${dimensions}</tbody></table>
<h2>Kolumny wymagające uwagi</h2>
<table><thead><tr><th>Kolumna</th><th>Wynik</th><th>Status</th><th>Powód</th></tr></thead><tbody>${worst}</tbody></table>
<h2>Reguły ważności</h2>
<table><thead><tr><th>Kolumna</th><th>Reguła</th><th>Poprawne</th><th>Niepoprawne</th></tr></thead><tbody>${rules || '<tr><td colspan="4">Nie wybrano reguł.</td></tr>'}</tbody></table>
<p class="note">Progi: zielony od 95%, żółty 85–95%, czerwony poniżej 85%. Wynik łączny to średnia ze zmierzonych wymiarów. Raport dotyczy jednego pliku i trzech z sześciu wymiarów jakości danych (bez dokładności, spójności i aktualności). Dane były przetwarzane wyłącznie w przeglądarce.</p>
<p class="note">Pełny pomiar w sześciu wymiarach z planem naprawy: <a href="${OFFER_URL}" target="_blank" rel="noopener">audyt jakości danych</a>.</p>
</body>
</html>
`;
}
